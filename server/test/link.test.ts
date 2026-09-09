import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { linkUpdate, fullName, matchRoster } from '../src/roster/link.js'
import { athletes, auditLog, events, rosterCandidates, type RosterCandidateRow } from '../src/db/schema.js'
import { freshDb, seedEvent } from './fixtures.js'

const cand = (o: Partial<RosterCandidateRow>): RosterCandidateRow => ({
  id: 0, eventId: 0, wlUid: 'w0', firstName: 'Jonas', lastName: 'Blake', belt: 'yellow',
  wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4, age: 10, weightLbs: 70, gender: 'M', ...o,
})

describe('fullName', () => {
  it('joins first and last with a space', () => {
    expect(fullName({ firstName: 'Ana', lastName: 'Reyes' })).toBe('Ana Reyes')
  })
})

describe('linkUpdate', () => {
  it('writes every field on the first link', () => {
    const update = linkUpdate({ wlUid: null, ageSource: null, weightSource: null }, cand({}))
    expect(update).toEqual({
      wlUid: 'w0', wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4,
      belt: 'yellow', gender: 'M', age: 10, ageSource: 'leaderboard', weightLbs: 70, weightSource: 'leaderboard',
    })
  })

  it('never overwrites belt or gender with a null candidate value', () => {
    const update = linkUpdate(
      { wlUid: null, ageSource: null, weightSource: null },
      cand({ belt: null, gender: null, age: null, weightLbs: null }),
    )
    expect(update).toEqual({ wlUid: 'w0', wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4 })
  })

  it('keeps a manual age or weight on a refresh, not on the first link', () => {
    const refresh = linkUpdate({ wlUid: 'w0', ageSource: 'manual', weightSource: 'manual' }, cand({ age: 11, weightLbs: 75 }))
    expect(refresh.age).toBeUndefined()
    expect(refresh.weightLbs).toBeUndefined()
    const first = linkUpdate({ wlUid: null, ageSource: 'manual', weightSource: 'manual' }, cand({ age: 11, weightLbs: 75 }))
    expect(first).toMatchObject({ age: 11, ageSource: 'leaderboard', weightLbs: 75, weightSource: 'leaderboard' })
  })
})

describe('matchRoster', () => {
  it('links one exact candidate with force and lands every field', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const jonas = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Jonas', lastName: 'Blake', source: 'manual', teamId: s.teamA,
    }).returning().get()
    await db.insert(rosterCandidates).values({
      eventId: s.eventId, wlUid: 'w0', firstName: 'Jonas', lastName: 'Blake', belt: 'yellow',
      wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4, age: 10, weightLbs: 70, gender: 'M',
    }).run()

    const report = await matchRoster(db, s.eventId)
    expect(report.matched).toEqual(['Jonas Blake'])
    expect(report.refreshed).toBe(0)
    expect(report.unmatched.length).toBeGreaterThan(0) // the four seeded kids have no candidate

    const row = await db.select().from(athletes).where(eq(athletes.id, jonas.id)).get()
    expect(row).toMatchObject({
      wlUid: 'w0', wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4,
      belt: 'yellow', gender: 'M', age: 10, ageSource: 'leaderboard', weightLbs: 70, weightSource: 'leaderboard',
    })
  })

  it('keeps a typed belt when the candidate carries no belt', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const nora = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Nora', lastName: 'Diaz', source: 'manual', belt: 'grey', gender: 'F',
    }).returning().get()
    await db.insert(rosterCandidates).values({
      eventId: s.eventId, wlUid: 'w2', firstName: 'Nora', lastName: 'Diaz', belt: null, wlLocation: 'North',
      leaderboardId: null, erp: null, age: null, weightLbs: null, gender: null,
    }).run()

    const report = await matchRoster(db, s.eventId)
    expect(report.matched).toEqual(['Nora Diaz'])
    const row = await db.select().from(athletes).where(eq(athletes.id, nora.id)).get()
    expect(row).toMatchObject({ wlUid: 'w2', belt: 'grey', gender: 'F', age: null, weightLbs: null })
  })

  it('reports ambiguous and writes nothing when two candidates share a slug', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values({ eventId: s.eventId, firstName: 'Priya', lastName: 'Shah', source: 'manual' }).run()
    await db.insert(rosterCandidates).values([
      { eventId: s.eventId, wlUid: 'w3a', firstName: 'Priya', lastName: 'Shah', wlLocation: 'North' },
      { eventId: s.eventId, wlUid: 'w3b', firstName: 'Priya', lastName: 'Shah', wlLocation: 'South' },
    ]).run()

    const report = await matchRoster(db, s.eventId)
    expect(report.ambiguous).toEqual(['Priya Shah'])
    const row = await db.select().from(athletes).where(eq(athletes.eventId, s.eventId)).all()
    expect(row.find(a => a.lastName === 'Shah')?.wlUid).toBeNull()
  })

  it('reports duplicates when the only matching candidate is already on another athlete', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values([
      { eventId: s.eventId, firstName: 'Milo', lastName: 'Chen', source: 'wl', wlUid: 'wD' },
      { eventId: s.eventId, firstName: 'Milo', lastName: 'Chen', source: 'manual' },
    ]).run()
    await db.insert(rosterCandidates).values({ eventId: s.eventId, wlUid: 'wD', firstName: 'Milo', lastName: 'Chen', wlLocation: 'North' }).run()

    const report = await matchRoster(db, s.eventId)
    expect(report.duplicates).toEqual(['Milo Chen'])
    expect(report.matched).toEqual([])
  })

  it('refreshes a linked athlete, keeps a manual weight, and takes the pool erp', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const sam = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Sam', lastName: 'Reyes', source: 'wl', wlUid: 'w5',
      age: 9, weightLbs: 55, weightSource: 'manual', belt: 'white', gender: 'M', erp: null,
    }).returning().get()
    await db.insert(rosterCandidates).values({
      eventId: s.eventId, wlUid: 'w5', firstName: 'Sam', lastName: 'Reyes', belt: 'yellow', wlLocation: 'North',
      leaderboardId: 'sam-reyes', erp: 3.3, age: 10, weightLbs: 80, gender: 'M',
    }).run()

    const report = await matchRoster(db, s.eventId)
    expect(report.refreshed).toBe(1)
    expect(report.matched).toEqual([])
    const row = await db.select().from(athletes).where(eq(athletes.id, sam.id)).get()
    expect(row).toMatchObject({ weightLbs: 55, weightSource: 'manual', age: 10, ageSource: 'leaderboard', erp: 3.3, belt: 'yellow' })
  })

  it('writes no audit row and does not bump the version when nothing changed', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const before = await db.select({ version: events.version }).from(events).where(eq(events.id, s.eventId)).get()

    const report = await matchRoster(db, s.eventId)
    expect(report.matched).toEqual([])
    expect(report.refreshed).toBe(0)

    const after = await db.select({ version: events.version }).from(events).where(eq(events.id, s.eventId)).get()
    expect(after?.version).toBe(before?.version)
    const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).all()
    expect(rows.filter(r => r.action === 'roster_link')).toHaveLength(0)
  })

  it('bumps the version and records one roster_link audit row when something changed', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values({ eventId: s.eventId, firstName: 'Jonas', lastName: 'Blake', source: 'manual' }).run()
    await db.insert(rosterCandidates).values({ eventId: s.eventId, wlUid: 'w0', firstName: 'Jonas', lastName: 'Blake', wlLocation: 'North' }).run()

    const before = await db.select({ version: events.version }).from(events).where(eq(events.id, s.eventId)).get()
    await matchRoster(db, s.eventId)
    const after = await db.select({ version: events.version }).from(events).where(eq(events.id, s.eventId)).get()
    expect(after!.version).toBeGreaterThan(before!.version)

    const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).all()
    const row = rows.find(r => r.action === 'roster_link')
    expect(row).toBeDefined()
    expect(row?.detail).toMatchObject({ kind: 'match', matched: 1, refreshed: 0 })
  })
})
