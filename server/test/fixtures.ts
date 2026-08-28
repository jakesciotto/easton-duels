import { eq } from 'drizzle-orm'
import { createDb, migrateDb, type Db } from '../src/db/client.js'
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

export function freshDb(): Db {
  const db = createDb(':memory:')
  migrateDb(db)
  return db
}

// Two teams, two kids each, one default ruleset, `matCount` mats, up to two matches
// (a1 vs b1 on mat 1, a2 vs b2 on mat 2 or mat 1). `live` marks the event live and
// loads the first match on each mat without going through match/mats.ts.
export function seedEvent(db: Db, opts: { matCount?: number; live?: boolean; matches?: number } = {}): Seeded {
  const matCount = opts.matCount ?? 2
  const ev = db.insert(events).values({
    name: 'Fall Duels', date: '2026-10-03', matCount, matCode: '0420',
    status: opts.live ? 'live' : 'setup', createdAt: '2026-08-27T00:00:00.000Z',
  }).returning().get()
  const [ta, tb] = db.insert(teams).values([
    { eventId: ev.id, name: 'Boulder', color: 'red', position: 0 },
    { eventId: ev.id, name: 'Denver', color: 'blue', position: 1 },
  ]).returning().all()
  const kids = db.insert(athletes).values([
    { eventId: ev.id, teamId: ta.id, firstName: 'Mateo', lastName: 'Rivera', age: 8, weightLbs: 62, belt: 'grey', gender: 'M', source: 'manual', erp: 6.1 },
    { eventId: ev.id, teamId: ta.id, firstName: 'Ava', lastName: 'Park', age: 9, weightLbs: 70, belt: 'grey-black', gender: 'F', source: 'manual', erp: null },
    { eventId: ev.id, teamId: tb.id, firstName: 'Olivia', lastName: 'Kim', age: 8, weightLbs: 60, belt: 'grey-white', gender: 'F', source: 'manual', erp: 5.8 },
    { eventId: ev.id, teamId: tb.id, firstName: 'Noah', lastName: 'Tran', age: 10, weightLbs: 72, belt: 'yellow', gender: 'M', source: 'manual', erp: null },
  ]).returning().all()
  const rs = db.insert(rulesets).values({
    eventId: ev.id, name: 'Default', defaultLengthSec: DEFAULT_LENGTH_SEC, actions: DEFAULT_ACTIONS, terminals: DEFAULT_TERMINALS,
  }).returning().get()
  const matRows = db.insert(mats).values(Array.from({ length: matCount }, (_, i) => ({ eventId: ev.id, number: i + 1 }))).returning().all()
  const count = Math.min(opts.matches ?? 2, 2)
  const pairs = [[kids[0].id, kids[2].id], [kids[1].id, kids[3].id]]
  const matchRows = count === 0 ? [] : db.insert(matches).values(pairs.slice(0, count).map(([a, b], i) => ({
    eventId: ev.id, matId: matRows[i % matRows.length].id, orderIndex: i, rulesetId: rs.id,
    lengthSec: DEFAULT_LENGTH_SEC, athleteAId: a, athleteBId: b,
  }))).returning().all()
  if (opts.live) {
    for (const mat of matRows) {
      const first = matchRows.find(m => m.matId === mat.id)
      if (!first) continue
      db.update(matches).set({ status: 'live' }).where(eq(matches.id, first.id)).run()
      db.update(mats).set({ currentMatchId: first.id }).where(eq(mats.id, mat.id)).run()
    }
  }
  return {
    eventId: ev.id, teamA: ta.id, teamB: tb.id, rulesetId: rs.id, matIds: matRows.map(m => m.id),
    a1: kids[0].id, a2: kids[1].id, b1: kids[2].id, b2: kids[3].id, matchIds: matchRows.map(m => m.id),
  }
}
