import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createDb, initDb, migrateDb, type Db } from '../src/db/client.js'
import { events, teams, athletes, rulesets, mats, matches } from '../src/db/schema.js'
import { DEFAULT_ACTIONS, DEFAULT_TERMINALS, DEFAULT_LENGTH_SEC } from '../src/shared/types.js'

export interface Seeded {
  eventId: number
  teamA: number
  teamB: number
  rulesetId: number
  matIds: number[]
  a1: number
  a2: number
  b1: number
  b2: number
  matchIds: number[]
}

// @libsql/client's local driver opens a fresh connection after every db.transaction()
// call. A plain ':memory:' url gives that fresh connection its own empty database
// (so post-transaction reads see no tables), and ':memory:?cache=shared' shares one
// anonymous database process-wide (so unrelated tests collide). A unique temp file
// per db avoids both: reopening the same path reconnects to the same data, and every
// freshDb() call gets its own file.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-test-'))
process.on('exit', () => fs.rmSync(TMP_DIR, { recursive: true, force: true }))

export async function freshDb(): Promise<Db> {
  const url = `file:${path.join(TMP_DIR, `${randomUUID()}.db`)}`
  const db = createDb({ url })
  await initDb(db, { url })
  await migrateDb(db)
  return db
}

// Two teams, two kids each, one default ruleset, `matCount` mats, up to two matches
// (a1 vs b1 on mat 1, a2 vs b2 on mat 2 or mat 1). `live` marks the event live and
// loads the first match on each mat without going through match/mats.ts.
export async function seedEvent(db: Db, opts: { matCount?: number; live?: boolean; matches?: number } = {}): Promise<Seeded> {
  const matCount = opts.matCount ?? 2
  const ev = await db.insert(events).values({
    name: 'Fall Duels', date: '2026-10-03', matCount, matCode: '0420',
    status: opts.live ? 'live' : 'setup', createdAt: '2026-08-27T00:00:00.000Z',
  }).returning().get()
  const [ta, tb] = await db.insert(teams).values([
    { eventId: ev.id, name: 'Ridgeline', color: 'red', position: 0 },
    { eventId: ev.id, name: 'Lakeside', color: 'blue', position: 1 },
  ]).returning().all()
  const kids = await db.insert(athletes).values([
    { eventId: ev.id, teamId: ta.id, firstName: 'Mateo', lastName: 'Rivera', age: 8, weightLbs: 62, belt: 'grey', gender: 'M', source: 'manual', erp: 6.1 },
    { eventId: ev.id, teamId: ta.id, firstName: 'Ava', lastName: 'Park', age: 9, weightLbs: 70, belt: 'grey-black', gender: 'F', source: 'manual', erp: null },
    { eventId: ev.id, teamId: tb.id, firstName: 'Olivia', lastName: 'Kim', age: 8, weightLbs: 60, belt: 'grey-white', gender: 'F', source: 'manual', erp: 5.8 },
    { eventId: ev.id, teamId: tb.id, firstName: 'Noah', lastName: 'Tran', age: 10, weightLbs: 72, belt: 'yellow', gender: 'M', source: 'manual', erp: null },
  ]).returning().all()
  const rs = await db.insert(rulesets).values({
    eventId: ev.id, name: 'Default', defaultLengthSec: DEFAULT_LENGTH_SEC, actions: DEFAULT_ACTIONS, terminals: DEFAULT_TERMINALS,
  }).returning().get()
  const matRows = await db.insert(mats).values(Array.from({ length: matCount }, (_, i) => ({ eventId: ev.id, number: i + 1 }))).returning().all()
  const count = Math.min(opts.matches ?? 2, 2)
  const pairs = [[kids[0].id, kids[2].id], [kids[1].id, kids[3].id]]
  const matchRows = count === 0 ? [] : await db.insert(matches).values(pairs.slice(0, count).map(([a, b], i) => ({
    eventId: ev.id, matId: matRows[i % matRows.length].id, orderIndex: i, rulesetId: rs.id,
    lengthSec: DEFAULT_LENGTH_SEC, athleteAId: a, athleteBId: b,
  }))).returning().all()
  if (opts.live) {
    for (const mat of matRows) {
      const first = matchRows.find(m => m.matId === mat.id)
      if (!first) continue
      await db.update(matches).set({ status: 'live' }).where(eq(matches.id, first.id)).run()
      await db.update(mats).set({ currentMatchId: first.id }).where(eq(mats.id, mat.id)).run()
    }
  }
  return {
    eventId: ev.id, teamA: ta.id, teamB: tb.id, rulesetId: rs.id, matIds: matRows.map(m => m.id),
    a1: kids[0].id, a2: kids[1].id, b1: kids[2].id, b2: kids[3].id, matchIds: matchRows.map(m => m.id),
  }
}
