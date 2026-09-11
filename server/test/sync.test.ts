import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { syncRoster, profileChanges } from '../src/roster/sync.js'
import { athletes, auditLog, events, rosterCandidates } from '../src/db/schema.js'
import type { WlBeltRecord, LeaderboardCompetitor } from '../src/roster/types.js'
import { freshDb, seedEvent } from './fixtures.js'

const rec = (o: Partial<WlBeltRecord>): WlBeltRecord => ({
  uid: 'w0', kBusiness: '100001', location: 'North', firstName: 'Jonas', lastName: 'Blake',
  rankTitle: 'Yellow Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-03-14', ...o,
})

const comp = (o: Partial<LeaderboardCompetitor>): LeaderboardCompetitor => ({
  id: 'jonas-blake', name: 'Jonas Blake', belt: 'yellow', ageGroup: '10-10', gender: 'M',
  weightClass: '-70 lbs', academy: 'Ridgeline', erp: 4.4, ...o,
})

const row = (db: Awaited<ReturnType<typeof freshDb>>, id: number) =>
  db.select().from(athletes).where(eq(athletes.id, id)).get()

const syncRows = (db: Awaited<ReturnType<typeof freshDb>>, eventId: number) =>
  db.select().from(auditLog).where(eq(auditLog.eventId, eventId)).all().then(rows => rows.filter(r => r.action === 'roster_sync'))

const versionOf = (db: Awaited<ReturnType<typeof freshDb>>, eventId: number) =>
  db.select({ version: events.version }).from(events).where(eq(events.id, eventId)).get().then(r => r!.version)

describe('profileChanges', () => {
  it('reports only the fields the update carries and actually moves', () => {
    const before = { belt: 'grey', erp: 3.1, age: 9, weightLbs: 60, gender: 'M', wlLocation: 'North', promotedAt: null }
    expect(profileChanges(before, { belt: 'grey-white', erp: 3.4 })).toEqual({
      belt: { from: 'grey', to: 'grey-white' },
      erp: { from: 3.1, to: 3.4 },
    })
    expect(profileChanges(before, { belt: 'grey' })).toEqual({})
    expect(profileChanges(before, {})).toEqual({})
  })

  it('reads an absent value as null on both sides', () => {
    expect(profileChanges({ promotedAt: null }, { promotedAt: '2026-03-14' })).toEqual({
      promotedAt: { from: null, to: '2026-03-14' },
    })
  })
})

describe('syncRoster', () => {
  it('links an exact name with force and lands every field', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const jonas = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Jonas', lastName: 'Blake', source: 'manual', teamId: s.teamA,
    }).returning().get()

    const report = await syncRoster(db, s.eventId, [rec({})], [comp({})], { locations: 1, warnings: 0 })

    expect(report.linked).toEqual(['Jonas Blake'])
    expect(report.refreshed).toBe(0)
    expect(report.unmatched).toContain('Mateo Rivera')
    expect(await row(db, jonas.id)).toMatchObject({
      wlUid: 'w0', wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4, belt: 'yellow',
      promotedAt: '2026-03-14', age: 10, ageSource: 'leaderboard', weightLbs: 70, weightSource: 'leaderboard',
    })
    expect(typeof (await row(db, jonas.id))!.syncedAt).toBe('string')
  })

  it('takes a nickname, an accent, and a middle name as the same name', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values([
      { eventId: s.eventId, firstName: 'Alex', lastName: 'Reyes', source: 'manual' },
      { eventId: s.eventId, firstName: 'Jose Luis', lastName: 'Nunez Ortiz', source: 'manual' },
    ]).run()

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'w1', firstName: 'Alexander', lastName: 'Reyes' }),
      rec({ uid: 'w2', firstName: 'José', lastName: 'Núñez-Ortiz' }),
    ], [])

    expect(report.linked.sort()).toEqual(['Alex Reyes', 'Jose Luis Nunez Ortiz'].sort())
  })

  it('refreshes a linked athlete, keeps a manual weight, and records the diff', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const sam = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Sam', lastName: 'Reyes', source: 'wl', wlUid: 'w5',
      age: 9, weightLbs: 55, weightSource: 'manual', belt: 'grey', gender: 'M', erp: 3.1,
    }).returning().get()

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'w5', firstName: 'Sam', lastName: 'Reyes', rankTitle: 'Grey/White Belt', promotedAt: '2026-05-02' }),
    ], [comp({ id: 'sam-reyes', name: 'Sam Reyes', erp: 3.4, weightClass: '-80 lbs' })])

    expect(report.refreshed).toBe(1)
    expect(report.linked).toEqual([])
    expect(report.changed).toEqual(['Sam Reyes'])
    const after = await row(db, sam.id)
    expect(after).toMatchObject({ weightLbs: 55, weightSource: 'manual', age: 10, ageSource: 'leaderboard', belt: 'grey-white', erp: 3.4 })
    expect(after!.syncChanges).toMatchObject({
      belt: { from: 'grey', to: 'grey-white' },
      erp: { from: 3.1, to: 3.4 },
      promotedAt: { from: null, to: '2026-05-02' },
    })
    expect(after!.syncChanges).not.toHaveProperty('weightLbs')
  })

  it('writes an empty change set on a second sync that moved nothing', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const sam = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Sam', lastName: 'Reyes', source: 'wl', wlUid: 'w5',
    }).returning().get()
    const records = [rec({ uid: 'w5', firstName: 'Sam', lastName: 'Reyes' })]

    await syncRoster(db, s.eventId, records, [])
    const second = await syncRoster(db, s.eventId, records, [])

    expect(second.changed).toEqual([])
    expect((await row(db, sam.id))!.syncChanges).toEqual({})
  })

  it('leaves a linked row alone and reports it gone when the pool drops the uid', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const sam = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Sam', lastName: 'Reyes', source: 'wl', wlUid: 'w5', belt: 'grey',
    }).returning().get()

    const report = await syncRoster(db, s.eventId, [rec({})], [])

    expect(report.gone).toEqual(['Sam Reyes'])
    expect(report.refreshed).toBe(0)
    const after = await row(db, sam.id)
    expect(after).toMatchObject({ wlUid: 'w5', belt: 'grey' })
    expect(after!.syncChanges).toEqual({ pool: { from: 'present', to: 'missing' } })
  })

  it('stores the one near match with its score and names it in the report', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'w9', firstName: 'Mateo', lastName: 'Rivera-Lopez', location: 'Boulder' }),
    ], [])

    expect(report.suggested).toEqual([
      { athleteId: s.a1, name: 'Mateo Rivera', candidate: 'Mateo Rivera-Lopez', location: 'Boulder', score: 0.8 },
    ])
    expect(report.linked).toEqual([])
    expect(await row(db, s.a1)).toMatchObject({ wlUid: null, suggestedWlUid: 'w9', suggestedScore: 0.8 })
  })

  it('skips a candidate a person has already refused', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.update(athletes).set({ dismissedWlUids: ['w9'] }).where(eq(athletes.id, s.a1)).run()

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'w9', firstName: 'Mateo', lastName: 'Rivera-Lopez', location: 'Boulder' }),
    ], [])

    expect(report.suggested).toEqual([])
    expect(report.unmatched).toContain('Mateo Rivera')
    expect(await row(db, s.a1)).toMatchObject({ suggestedWlUid: null, suggestedScore: null })
  })

  it('clears a suggestion the pool no longer supports', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.update(athletes).set({ suggestedWlUid: 'w9', suggestedScore: 0.8 }).where(eq(athletes.id, s.a1)).run()

    await syncRoster(db, s.eventId, [], [])

    expect(await row(db, s.a1)).toMatchObject({ suggestedWlUid: null, suggestedScore: null })
  })

  it('writes nothing when two candidates carry the same name', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'wa', firstName: 'Mateo', lastName: 'Rivera', location: 'North' }),
      rec({ uid: 'wb', firstName: 'Mateo', lastName: 'Rivera', location: 'South' }),
    ], [])

    expect(report.ambiguous).toEqual(['Mateo Rivera'])
    expect(report.linked).toEqual([])
    expect(await row(db, s.a1)).toMatchObject({ wlUid: null, syncedAt: null, suggestedWlUid: null })
  })

  it('offers nothing when the two best candidates score inside the margin', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'wa', firstName: 'Mateo', lastName: 'Rivera-Lopez' }),
      rec({ uid: 'wb', firstName: 'Mateo', lastName: 'Rivera-Cruz' }),
    ], [])

    expect(report.suggested).toEqual([])
    expect(report.unmatched).toContain('Mateo Rivera')
  })

  it('never offers a candidate another athlete of the event already holds', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.update(athletes).set({ wlUid: 'w9' }).where(eq(athletes.id, s.a2)).run()

    const report = await syncRoster(db, s.eventId, [
      rec({ uid: 'w9', firstName: 'Mateo', lastName: 'Rivera-Lopez' }),
    ], [])

    expect(report.suggested).toEqual([])
    expect(report.unmatched).toContain('Mateo Rivera')
  })

  it('replaces the pool, and reads the cached one when no records are given', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await syncRoster(db, s.eventId, [rec({}), rec({ uid: 'w1', firstName: 'Ana', lastName: 'Bell' })], [])
    expect(await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()).toHaveLength(2)

    await syncRoster(db, s.eventId, [rec({})], [])
    const pool = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()
    expect(pool.map(c => c.wlUid)).toEqual(['w0'])
    expect(pool[0]).toMatchObject({ promotedAt: '2026-03-14' })

    await db.insert(athletes).values({ eventId: s.eventId, firstName: 'Jonas', lastName: 'Blake', source: 'manual' }).run()
    const report = await syncRoster(db, s.eventId, null, [])
    expect(report.linked).toEqual(['Jonas Blake'])
    expect(await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()).toHaveLength(1)
  })

  it('writes no audit row and does not bump the version when a pool run changed nothing', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const before = await versionOf(db, s.eventId)

    const report = await syncRoster(db, s.eventId, null, [])

    expect(report.linked).toEqual([])
    expect(report.refreshed).toBe(0)
    expect(await versionOf(db, s.eventId)).toBe(before)
    expect(await syncRows(db, s.eventId)).toHaveLength(0)
  })

  it('stamps the time it looked on a row WellnessLiving had nobody for', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const before = await versionOf(db, s.eventId)

    const report = await syncRoster(db, s.eventId, [rec({})], [], { locations: 1, warnings: 0 })

    expect(report.unmatched).toContain('Mateo Rivera')
    const mateo = await row(db, s.a1)
    expect(typeof mateo!.syncedAt).toBe('string')
    expect(mateo!.syncChanges).toEqual({})
    expect(await versionOf(db, s.eventId)).toBeGreaterThan(before)
  })

  it('stamps a two letter name it asked about, and leaves a nameless row alone', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const amy = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Amy', lastName: 'Ng', source: 'manual',
    }).returning().get()
    const kai = await db.insert(athletes).values({
      eventId: s.eventId, firstName: 'Kai', lastName: '', source: 'manual',
    }).returning().get()

    await syncRoster(db, s.eventId, [rec({})], [], { locations: 1, warnings: 0 })

    expect(typeof (await row(db, amy.id))!.syncedAt).toBe('string')
    expect((await row(db, kai.id))!.syncedAt).toBeNull()
  })

  it('clears a stale suggestion on a row it could not ask about, without saying it looked', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const looked = '2026-09-01T00:00:00.000Z'
    // The row earned its suggestion while its name still carried a token, and was renamed
    // to something searchable by nothing after that.
    await db.update(athletes).set({ suggestedWlUid: 'w9', suggestedScore: 0.8, syncedAt: looked }).where(eq(athletes.id, s.a1)).run()
    await db.update(athletes).set({ firstName: 'Kai', lastName: '--' }).where(eq(athletes.id, s.a1)).run()

    await syncRoster(db, s.eventId, [rec({})], [], { locations: 1, warnings: 0 })

    const after = await row(db, s.a1)
    expect(after).toMatchObject({ suggestedWlUid: null, suggestedScore: null })
    expect(after!.syncedAt).toBe(looked)
  })

  it('leaves syncedAt alone on a rematch, which asked WellnessLiving nothing', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })

    await syncRoster(db, s.eventId, null, [])

    expect((await row(db, s.a1))!.syncedAt).toBeNull()
  })

  it('records the pull even when it moved no athlete, without bumping the version', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.delete(athletes).where(eq(athletes.eventId, s.eventId)).run()
    const before = await versionOf(db, s.eventId)

    await syncRoster(db, s.eventId, [], [], { locations: 2, warnings: 1 })

    expect(await versionOf(db, s.eventId)).toBe(before)
    const rows = await syncRows(db, s.eventId)
    expect(rows).toHaveLength(1)
    expect(rows[0].detail).toMatchObject({ locations: 2, candidates: 0, warnings: 1, linked: 0, refreshed: 0 })
  })

  it('records one roster_sync row with the counts and the names, and bumps the version', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values({ eventId: s.eventId, firstName: 'Jonas', lastName: 'Blake', source: 'manual' }).run()
    const before = await versionOf(db, s.eventId)

    await syncRoster(db, s.eventId, [
      rec({}),
      rec({ uid: 'w9', firstName: 'Mateo', lastName: 'Rivera-Lopez', location: 'Boulder' }),
    ], [comp({})], { locations: 1, warnings: 0 })

    expect(await versionOf(db, s.eventId)).toBeGreaterThan(before)
    const rows = await syncRows(db, s.eventId)
    expect(rows).toHaveLength(1)
    expect(rows[0].actor).toBe('admin')
    expect(rows[0].detail).toMatchObject({
      locations: 1, candidates: 2, warnings: 0,
      linked: 1, refreshed: 0, changed: 0, suggested: 1, ambiguous: 0, unmatched: 3, gone: 0,
      names: { suggested: ['Mateo Rivera'], ambiguous: [], gone: [] },
    })
  })
})

describe('syncRoster, a pool the size of the gym', () => {
  it('writes four thousand candidates in one sync, under SQLite\'s bind limit', async () => {
    // Eight locations gave 4671 kids at thirteen columns, 60723 variables in the one
    // insert the route used to issue, and SQLite refused it with "too many SQL variables".
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const records = Array.from({ length: 4000 }, (_, i) => rec({ uid: `w${i}`, firstName: `First${i}`, lastName: `Last${i}` }))
    const report = await syncRoster(db, s.eventId, records, [], { locations: 8, warnings: 0 })
    const pool = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()
    expect(pool).toHaveLength(4000)
    expect(report.linked).toEqual([])
  })
})
