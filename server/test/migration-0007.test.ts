import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { asc, sql } from 'drizzle-orm'
import { createDb, initDb, migrateDb } from '../src/db/client.js'
import { auditLog } from '../src/db/schema.js'

const DRIZZLE = path.join(import.meta.dirname, '../drizzle')

// The backfill runs exactly once against the real database, so it is exercised the only
// way that proves anything: migrate to 0006, write the match events an afternoon would
// have left there, then let 0007 run for real.
async function dbAt0006() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-mig-'))
  const folder = path.join(dir, 'drizzle')
  fs.cpSync(DRIZZLE, folder, { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'))
  const full = journal.entries
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: full.filter((e: { idx: number }) => e.idx <= 6) }))
  const url = `file:${path.join(dir, `${randomUUID()}.db`)}`
  const db = createDb({ url })
  await initDb(db, { url })
  await migrateDb(db, folder)
  const to0007 = async () => {
    fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    await migrateDb(db, folder)
  }
  return { db, to0007, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('migration 0007 backfill', () => {
  it('writes one audit row per match event, with the actor read off the id prefix', async () => {
    const { db, to0007, cleanup } = await dbAt0006()
    try {
      await db.run(sql`insert into events (id, name, date, mat_count, mat_code, created_at) values (1, 'Fall Duels', '2026-10-03', 2, '0420', '2026-10-03T15:00:00.000Z')`)
      await db.run(sql`insert into athletes (id, event_id, first_name, last_name, source) values (1, 1, 'Mateo', 'Rivera', 'manual'), (2, 1, 'Olivia', 'Kim', 'manual')`)
      await db.run(sql`insert into rulesets (id, event_id, name, default_length_sec, actions, terminals) values (1, 1, 'Default', 300, '[]', '[]')`)
      await db.run(sql`insert into mats (id, event_id, number) values (1, 1, 3)`)
      await db.run(sql`insert into matches (id, event_id, mat_id, order_index, ruleset_id, length_sec, athlete_a_id, athlete_b_id) values (1, 1, 1, 0, 1, 300, 1, 2)`)
      // The same match, but off every mat, which is how a typed entry's match is stored.
      await db.run(sql`insert into matches (id, event_id, mat_id, order_index, ruleset_id, length_sec, athlete_a_id, athlete_b_id) values (2, 1, null, 1, 1, 300, 1, 2)`)
      await db.run(sql`insert into match_events (id, match_id, seq, type, at) values
        ('tablet-0001', 1, 1, 'score', '2026-10-03T16:00:00.000Z'),
        ('expiry:1:1', 1, 2, 'clock_pause', '2026-10-03T16:01:00.000Z'),
        ('admin:1:3', 1, 3, 'admin', '2026-10-03T16:02:00.000Z'),
        ('entry:abc-0002', 2, 1, 'set_score', '2026-10-03T16:03:00.000Z'),
        ('server-only', 2, 2, 'end', '2026-10-03T16:04:00.000Z')`)

      await to0007()

      const rows = await db.select().from(auditLog).orderBy(asc(auditLog.id)).all()
      expect(rows.map(r => [r.actor, r.action, r.matchId])).toEqual([
        ['mat:3', 'score', 1],
        ['system', 'clock_pause', 1],
        ['admin', 'admin', 1],
        ['desk', 'set_score', 2],
        ['system', 'end', 2],
      ])
      expect(rows.every(r => r.eventId === 1)).toBe(true)
      expect(rows[0].detail).toEqual({ seq: 1, backfilled: true })
      expect(rows[0].at).toBe('2026-10-03T16:00:00.000Z')
      expect(rows[4].detail).toEqual({ seq: 2, backfilled: true })
    } finally {
      cleanup()
    }
  })

  it('leaves the certified_at column empty and every event status untouched', async () => {
    const { db, to0007, cleanup } = await dbAt0006()
    try {
      await db.run(sql`insert into events (id, name, date, mat_count, mat_code, status, created_at) values (1, 'Fall Duels', '2026-10-03', 1, '0420', 'done', '2026-10-03T15:00:00.000Z')`)
      await to0007()
      const row = await db.get<{ status: string; certified_at: string | null }>(sql`select status, certified_at from events where id = 1`)
      expect(row).toEqual({ status: 'done', certified_at: null })
      expect(await db.select().from(auditLog).all()).toEqual([])
    } finally {
      cleanup()
    }
  })
})
