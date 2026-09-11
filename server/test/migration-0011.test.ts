import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, initDb, migrateDb } from '../src/db/client.js'

const DRIZZLE = path.join(import.meta.dirname, '../drizzle')

// Multi-team: proposals get their own table and every match says where it came from.
// Migrated to 0010 first, where neither exists, so the add runs against real rows.
async function dbAt0010() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-mig-'))
  const folder = path.join(dir, 'drizzle')
  fs.cpSync(DRIZZLE, folder, { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'))
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx <= 10) }))
  const url = `file:${path.join(dir, `${randomUUID()}.db`)}`
  const db = createDb({ url })
  await initDb(db, { url })
  await migrateDb(db, folder)
  const to0011 = async () => {
    fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    await migrateDb(db, folder)
  }
  return { db, to0011, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

async function seedAt0010(db: Awaited<ReturnType<typeof dbAt0010>>['db']) {
  await db.run(sql`insert into events
    (id, name, date, mat_count, mat_code, status, mode, same_gender, created_at)
    values (1, 'Fall Duels', '2026-10-03', 1, '0420', 'setup', 'live', 0, '2026-10-03T15:00:00.000Z')`)
  await db.run(sql`insert into teams (id, event_id, name, color, position) values (1, 1, 'Ridgeline', 'red', 0)`)
  await db.run(sql`insert into teams (id, event_id, name, color, position) values (2, 1, 'Lakeside', 'blue', 1)`)
  await db.run(sql`insert into athletes (id, event_id, team_id, first_name, last_name, source) values (1, 1, 1, 'Mateo', 'Rivera', 'manual')`)
  await db.run(sql`insert into athletes (id, event_id, team_id, first_name, last_name, source) values (2, 1, 2, 'Olivia', 'Kim', 'manual')`)
  await db.run(sql`insert into rulesets (id, event_id, name, default_length_sec, actions, terminals) values (1, 1, 'Default', 300, '[]', '[]')`)
  await db.run(sql`insert into matches
    (id, event_id, order_index, ruleset_id, length_sec, athlete_a_id, athlete_b_id)
    values (1, 1, 0, 1, 300, 1, 2)`)
}

describe('migration 0011 adds proposals and the match source', () => {
  it('reads designed for a match that existed before it', async () => {
    const { db, to0011, cleanup } = await dbAt0010()
    try {
      await seedAt0010(db)
      await to0011()
      expect(await db.get<Record<string, unknown>>(sql`select id, source from matches where id = 1`)).toEqual({ id: 1, source: 'designed' })
    } finally {
      cleanup()
    }
  })

  it('holds a proposal with its cost and reason, indexed by event', async () => {
    const { db, to0011, cleanup } = await dbAt0010()
    try {
      await seedAt0010(db)
      await to0011()
      await db.run(sql`insert into proposals
        (id, event_id, athlete_a_id, athlete_b_id, cost, why, created_at)
        values (1, 1, 1, 2, 2.5, 'same class, 1 year apart', '2026-10-03T15:30:00.000Z')`)
      expect(await db.get<Record<string, unknown>>(sql`select * from proposals where id = 1`)).toEqual({
        id: 1, event_id: 1, athlete_a_id: 1, athlete_b_id: 2, cost: 2.5,
        why: 'same class, 1 year apart', created_at: '2026-10-03T15:30:00.000Z',
      })
      const indexes = (await db.all<{ name: string }>(sql`pragma index_list(proposals)`)).map(i => i.name)
      expect(indexes).toContain('proposals_event_idx')
    } finally {
      cleanup()
    }
  })

  it('drops a proposal with the kid and with the event', async () => {
    const { db, to0011, cleanup } = await dbAt0010()
    try {
      await seedAt0010(db)
      await to0011()
      await db.run(sql`insert into proposals (id, event_id, athlete_a_id, athlete_b_id, cost, why, created_at)
        values (1, 1, 1, 2, 2.5, 'same class', '2026-10-03T15:30:00.000Z')`)
      await db.run(sql`delete from matches where id = 1`)
      await db.run(sql`delete from athletes where id = 1`)
      expect(await db.get<{ n: number }>(sql`select count(*) as n from proposals`)).toEqual({ n: 0 })

      await db.run(sql`insert into proposals (id, event_id, athlete_a_id, athlete_b_id, cost, why, created_at)
        values (2, 1, 2, 2, 2.5, 'same class', '2026-10-03T15:30:00.000Z')`)
      await db.run(sql`delete from events where id = 1`)
      expect(await db.get<{ n: number }>(sql`select count(*) as n from proposals`)).toEqual({ n: 0 })
    } finally {
      cleanup()
    }
  })
})
