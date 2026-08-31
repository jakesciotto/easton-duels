import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { solveAssignment } from '../src/matchmaker/hungarian.js'
import { pairCost, beltDistance, EXCLUDED, type Matchable } from '../src/matchmaker/cost.js'
import { generateMatches } from '../src/matchmaker/generate.js'
import { freshDb, seedEvent } from './fixtures.js'
import { events, matches } from '../src/db/schema.js'
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
const c = { maxAgeGap: 1, maxWeightGap: 10, sameGender: false }

describe('pairCost', () => {
  it('uses the ERP gap when both are rated', () => {
    expect(pairCost(kid({ erp: 6.1 }), kid({ id: 2, erp: 5.8 }), c)).toEqual({ cost: expect.closeTo(0.3, 5), why: 'ERP 6.1 vs 5.8' })
  })
  it('falls back to belt, age, and weight', () => {
    const r = pairCost(kid({ belt: 'grey' }), kid({ id: 2, belt: 'yellow', age: 9, weightLbs: 65 }), c)
    expect(r.cost).toBeCloseTo(1 + 0.5 + 0.5, 5)
    expect(r.why).toBe('belt + age + weight')
  })
  it('excludes on age, weight, gender, and missing data', () => {
    expect(pairCost(kid({}), kid({ id: 2, age: 10 }), c).cost).toBe(EXCLUDED)
    expect(pairCost(kid({}), kid({ id: 2, weightLbs: 75 }), c).cost).toBe(EXCLUDED)
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
    await db.update(events).set({ maxAgeGap: 0 }).where(eq(events.id, s.eventId)).run()
    const r = await generateMatches(db, s.eventId)
    expect(r.created).toBe(1)
    expect(r.unpairedA).toEqual([s.a2])
    expect(r.unpairedB).toEqual([s.b2])
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
