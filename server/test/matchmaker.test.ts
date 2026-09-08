import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { solveAssignment } from '../src/matchmaker/hungarian.js'
import { pairCost, beltDistance, EXCLUDED, type Matchable } from '../src/matchmaker/cost.js'
import { generateMatches } from '../src/matchmaker/generate.js'
import { freshDb, seedEvent } from './fixtures.js'
import { events, matches, athletes, auditLog } from '../src/db/schema.js'
import { endMatch, loadMatch } from '../src/match/events.js'

describe('solveAssignment', () => {
  it('finds the minimum-cost perfect matching', () => {
    expect(solveAssignment([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2])
  })
  it('handles rectangular matrices and leaves surplus rows unassigned', () => {
    const r = solveAssignment([[1, 9], [9, 1], [5, 5]])
    expect(r.slice(0, 2)).toEqual([0, 1])
    expect(r[2]).toBe(-1)
    expect(solveAssignment([[1, 2, 3]])).toEqual([0])
  })
  it('returns empty for empty input', () => {
    expect(solveAssignment([])).toEqual([])
  })
})

const kid = (o: Partial<Matchable>): Matchable => ({ id: 1, age: 8, weightLbs: 60, belt: 'grey', gender: 'M', erp: null, ...o })
const c = { sameGender: false }

describe('pairCost', () => {
  it('uses the ERP gap when both are rated', () => {
    expect(pairCost(kid({ erp: 6.1 }), kid({ id: 2, erp: 5.8 }), c)).toEqual({ cost: expect.closeTo(0.3, 5), why: 'ERP 6.1 vs 5.8' })
  })
  it('falls back to belt, age, and weight', () => {
    const r = pairCost(kid({ belt: 'grey' }), kid({ id: 2, belt: 'yellow', age: 9, weightLbs: 65 }), c)
    expect(r.cost).toBeCloseTo(1 + 0.5 + 0.5, 5)
    expect(r.why).toBe('belt + age + weight')
  })
  it('excludes on gender and missing data, but a wide age or weight gap only costs more', () => {
    // B2: the two hard exclusions are gone. A pair 22 years and 140 pounds apart still
    // gets a cost, not a refusal; the gym's soft cost already prefers the closer pair.
    expect(pairCost(kid({}), kid({ id: 2, age: 30, weightLbs: 200 }), c).cost).toBeLessThan(EXCLUDED)
    expect(pairCost(kid({}), kid({ id: 2, gender: 'F' }), { ...c, sameGender: true }).cost).toBe(EXCLUDED)
    expect(pairCost(kid({}), kid({ id: 2, gender: 'F' }), c).cost).toBeLessThan(EXCLUDED)
    expect(pairCost(kid({ age: null }), kid({ id: 2 }), c).cost).toBe(EXCLUDED)
  })
})

describe('beltDistance', () => {
  it('counts families whole and stripes as a third', () => {
    expect(beltDistance('grey', 'grey')).toBe(0)
    expect(beltDistance('grey-white', 'grey-black')).toBeCloseTo(0.66, 5)
    expect(beltDistance('grey', 'yellow')).toBe(1)
    expect(beltDistance('white', 'green-black')).toBeCloseTo(4 + 0.33, 5)
    expect(beltDistance(null, 'grey')).toBe(2)
  })
})

describe('generateMatches', () => {
  it('pairs by ERP first, orders by weight, and round-robins mats', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 2, matches: 0 })
    const r = await generateMatches(db, s.eventId)
    expect(r).toEqual({ created: 2, unpairedA: [], unpairedB: [] })
    const rows = await db.select().from(matches).where(eq(matches.eventId, s.eventId)).orderBy(matches.orderIndex).all()
    expect(rows.map(m => [m.athleteAId, m.athleteBId, m.matId, m.orderIndex])).toEqual([[s.a1, s.b1, s.matIds[0], 0], [s.a2, s.b2, s.matIds[1], 1]])
    expect(rows[0].why).toBe('ERP 6.1 vs 5.8')
    expect(rows[1].why).toBe('belt + age + weight')
    expect(rows[0].lengthSec).toBe(300)
  })

  it('leaves excluded kids unpaired and lists them', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    // Age and weight no longer exclude a pair, so sameGender is the lever: a1 and b1
    // are brought to the same gender so they pair, and a2 stays cross gender from b2.
    await db.update(events).set({ sameGender: true }).where(eq(events.id, s.eventId)).run()
    await db.update(athletes).set({ gender: 'M' }).where(eq(athletes.id, s.b1)).run()
    const r = await generateMatches(db, s.eventId)
    expect(r.created).toBe(1)
    expect(r.unpairedA).toEqual([s.a2])
    expect(r.unpairedB).toEqual([s.b2])
  })

  it('records one match_create row per match created, beside no event-level row of its own', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 2, matches: 0 })
    const r = await generateMatches(db, s.eventId)
    const created = await db.select().from(matches).where(eq(matches.eventId, s.eventId)).orderBy(matches.orderIndex).all()
    const audited = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).orderBy(auditLog.id).all()
    expect(audited).toHaveLength(r.created)
    expect(audited.every(row => row.actor === 'admin' && row.action === 'match_create')).toBe(true)
    expect(audited.map(row => row.matchId)).toEqual(created.map(m => m.id))
    expect(audited[0].detail).toEqual({ athleteAId: created[0].athleteAId, athleteBId: created[0].athleteBId, matId: created[0].matId, matNumber: 1 })
  })

  it('replaces pending matches and keeps done ones', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    await endMatch(db, { id: 'end1', matchId: s.matchIds[0], lastSeq: 0, winnerAthleteId: s.a1 })
    const r = await generateMatches(db, s.eventId)
    expect(r.created).toBe(2)
    const rows = await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()
    expect(rows).toHaveLength(3)
    expect((await loadMatch(db, s.matchIds[0])).status).toBe('done')
    expect(rows.filter(m => m.status === 'pending').map(m => m.orderIndex).sort()).toEqual([1, 2])
  })
})
