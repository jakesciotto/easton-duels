import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, initDb, migrateDb } from '../src/db/client.js'

const DRIZZLE = path.join(import.meta.dirname, '../drizzle')

// B2: the two hard exclusions never mattered to how the gym pairs kids, so the columns
// go. Migrated to 0007 first, where max_age_gap and max_weight_gap still exist, so the
// drop is exercised against a real event row rather than an empty table.
async function dbAt0007() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-mig-'))
  const folder = path.join(dir, 'drizzle')
  fs.cpSync(DRIZZLE, folder, { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta/_journal.json'), 'utf8'))
  const full = journal.entries
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: full.filter((e: { idx: number }) => e.idx <= 7) }))
  const url = `file:${path.join(dir, `${randomUUID()}.db`)}`
  const db = createDb({ url })
  await initDb(db, { url })
  await migrateDb(db, folder)
  const to0008 = async () => {
    fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    await migrateDb(db, folder)
  }
  return { db, to0008, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('migration 0008 drops the age and weight gap columns', () => {
  it('drops both columns and leaves the event row otherwise intact', async () => {
    const { db, to0008, cleanup } = await dbAt0007()
    try {
      await db.run(sql`insert into events
        (id, name, date, mat_count, mat_code, status, mode, max_age_gap, max_weight_gap, same_gender, created_at)
        values (1, 'Fall Duels', '2026-10-03', 2, '0420', 'setup', 'live', 2, 15, 1, '2026-10-03T15:00:00.000Z')`)

      await to0008()

      const columns = await db.all<{ name: string }>(sql`pragma table_info(events)`)
      const names = columns.map(c => c.name)
      expect(names).not.toContain('max_age_gap')
      expect(names).not.toContain('max_weight_gap')

      const row = await db.get<Record<string, unknown>>(sql`select * from events where id = 1`)
      expect(row).toMatchObject({
        id: 1,
        name: 'Fall Duels',
        date: '2026-10-03',
        mat_count: 2,
        mat_code: '0420',
        status: 'setup',
        mode: 'live',
        same_gender: 1,
      })
      expect(row).not.toHaveProperty('max_age_gap')
      expect(row).not.toHaveProperty('max_weight_gap')
    } finally {
      cleanup()
    }
  })
})
