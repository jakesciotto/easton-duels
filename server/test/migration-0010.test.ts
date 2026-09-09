import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, initDb, migrateDb } from '../src/db/client.js'

const DRIZZLE = path.join(import.meta.dirname, '../drizzle')

// Profile sync: the event remembers its locations, and every athlete carries what the
// last sync found. Migrated to 0009 first, where none of the columns exist yet, so the
// adds run against real rows rather than an empty table.
async function dbAt0009() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-mig-'))
  const folder = path.join(dir, 'drizzle')
  fs.cpSync(DRIZZLE, folder, { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'))
  const full = journal.entries
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: full.filter((e: { idx: number }) => e.idx <= 9) }))
  const url = `file:${path.join(dir, `${randomUUID()}.db`)}`
  const db = createDb({ url })
  await initDb(db, { url })
  await migrateDb(db, folder)
  const to0010 = async () => {
    fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    await migrateDb(db, folder)
  }
  return { db, to0010, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

async function seedAt0009(db: Awaited<ReturnType<typeof dbAt0009>>['db']) {
  await db.run(sql`insert into events
    (id, name, date, mat_count, mat_code, status, mode, same_gender, created_at)
    values (1, 'Fall Duels', '2026-10-03', 2, '0420', 'setup', 'live', 0, '2026-10-03T15:00:00.000Z')`)
  await db.run(sql`insert into athletes
    (id, event_id, first_name, last_name, belt, source, wl_uid)
    values (1, 1, 'Mateo', 'Rivera', 'grey', 'wl', 'w1')`)
  await db.run(sql`insert into roster_candidates
    (id, event_id, wl_uid, first_name, last_name, belt)
    values (1, 1, 'w1', 'Mateo', 'Rivera', 'grey')`)
}

describe('migration 0010 adds the profile sync columns', () => {
  it('adds every column and leaves the seeded rows intact', async () => {
    const { db, to0010, cleanup } = await dbAt0009()
    try {
      await seedAt0009(db)
      await to0010()

      const eventCols = (await db.all<{ name: string }>(sql`pragma table_info(events)`)).map(c => c.name)
      expect(eventCols).toContain('wl_locations')
      const athleteCols = (await db.all<{ name: string }>(sql`pragma table_info(athletes)`)).map(c => c.name)
      for (const col of ['promoted_at', 'synced_at', 'sync_changes', 'suggested_wl_uid', 'suggested_score', 'dismissed_wl_uids']) {
        expect(athleteCols, col).toContain(col)
      }
      expect((await db.all<{ name: string }>(sql`pragma table_info(roster_candidates)`)).map(c => c.name)).toContain('promoted_at')

      const ev = await db.get<Record<string, unknown>>(sql`select * from events where id = 1`)
      expect(ev).toMatchObject({ id: 1, name: 'Fall Duels', mat_code: '0420', wl_locations: null })
      const kid = await db.get<Record<string, unknown>>(sql`select * from athletes where id = 1`)
      expect(kid).toMatchObject({
        id: 1, first_name: 'Mateo', last_name: 'Rivera', belt: 'grey', wl_uid: 'w1',
        promoted_at: null, synced_at: null, sync_changes: null, suggested_wl_uid: null, suggested_score: null,
      })
      // The one column with a default: an athlete has dismissed nobody until a person says so.
      expect(kid?.dismissed_wl_uids).toBe('[]')
      expect(await db.get<Record<string, unknown>>(sql`select * from roster_candidates where id = 1`)).toMatchObject({ promoted_at: null })
    } finally {
      cleanup()
    }
  })

  it('keeps the written values across the migration path', async () => {
    const { db, to0010, cleanup } = await dbAt0009()
    try {
      await seedAt0009(db)
      await to0010()
      await db.run(sql`update events set wl_locations = '["100001","100002"]' where id = 1`)
      await db.run(sql`update athletes set promoted_at = '2026-03-14', synced_at = '2026-09-09T15:00:00.000Z',
        sync_changes = '{"belt":{"from":"grey","to":"grey-white"}}', suggested_wl_uid = 'w9', suggested_score = 0.82,
        dismissed_wl_uids = '["w8"]' where id = 1`)

      expect(await db.get<Record<string, unknown>>(sql`select wl_locations from events where id = 1`)).toEqual({ wl_locations: '["100001","100002"]' })
      expect(await db.get<Record<string, unknown>>(sql`select * from athletes where id = 1`)).toMatchObject({
        promoted_at: '2026-03-14', synced_at: '2026-09-09T15:00:00.000Z', suggested_wl_uid: 'w9', suggested_score: 0.82,
        dismissed_wl_uids: '["w8"]',
      })
    } finally {
      cleanup()
    }
  })
})
