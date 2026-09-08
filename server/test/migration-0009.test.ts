import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, initDb, migrateDb } from '../src/db/client.js'

const DRIZZLE = path.join(import.meta.dirname, '../drizzle')

// G24: the far correction moves from a browser's query string and localStorage onto the
// event itself. Migrated to 0008 first, where the column does not exist yet, so the add
// is exercised against a real event row rather than an empty table.
async function dbAt0008() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-mig-'))
  const folder = path.join(dir, 'drizzle')
  fs.cpSync(DRIZZLE, folder, { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'))
  const full = journal.entries
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: full.filter((e: { idx: number }) => e.idx <= 8) }))
  const url = `file:${path.join(dir, `${randomUUID()}.db`)}`
  const db = createDb({ url })
  await initDb(db, { url })
  await migrateDb(db, folder)
  const to0009 = async () => {
    fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    await migrateDb(db, folder)
  }
  return { db, to0009, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('migration 0009 adds the far column', () => {
  it('adds a nullable far column and leaves the event row otherwise intact', async () => {
    const { db, to0009, cleanup } = await dbAt0008()
    try {
      await db.run(sql`insert into events
        (id, name, date, mat_count, mat_code, status, mode, same_gender, created_at)
        values (1, 'Fall Duels', '2026-10-03', 2, '0420', 'setup', 'live', 1, '2026-10-03T15:00:00.000Z')`)

      await to0009()

      const columns = await db.all<{ name: string }>(sql`pragma table_info(events)`)
      expect(columns.map(c => c.name)).toContain('far')

      const row = await db.get<Record<string, unknown>>(sql`select * from events where id = 1`)
      expect(row).toMatchObject({ id: 1, name: 'Fall Duels', mat_count: 2, mat_code: '0420', far: null })
    } finally {
      cleanup()
    }
  })

  it('keeps a written far value across the migration path', async () => {
    const { db, to0009, cleanup } = await dbAt0008()
    try {
      await db.run(sql`insert into events
        (id, name, date, mat_count, mat_code, status, mode, same_gender, created_at)
        values (1, 'Fall Duels', '2026-10-03', 1, '0420', 'setup', 'live', 0, '2026-10-03T15:00:00.000Z')`)
      await to0009()
      await db.run(sql`update events set far = 1.1 where id = 1`)
      const row = await db.get<{ far: number | null }>(sql`select far from events where id = 1`)
      expect(row).toEqual({ far: 1.1 })
    } finally {
      cleanup()
    }
  })
})
