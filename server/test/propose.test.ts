import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import type { Db } from '../src/db/client.js'
import { athletes, auditLog, events, matches, proposals } from '../src/db/schema.js'
import { proposeMatches, pairCost, pairWhy } from '../src/matchmaker/propose.js'

interface Kid {
  name: string
  team: 'A' | 'B' | 'C'
  age?: number | null
  lbs?: number | null
  belt?: string | null
  gender?: string | null
  erp?: number | null
}

// The proposer reads a whole pool, so these tests write the pool themselves rather than
// working around the fixture's own four kids.
async function pool(db: Db, kids: Kid[]) {
  const s = await seedEvent(db, { matches: 0, thirdTeam: true })
  await db.delete(athletes).where(eq(athletes.eventId, s.eventId)).run()
  const teamOf = { A: s.teamA, B: s.teamB, C: s.teamC! }
  const rows = await db.insert(athletes).values(kids.map(k => ({
    eventId: s.eventId, teamId: teamOf[k.team], firstName: k.name, lastName: 'Vantel',
    age: k.age === undefined ? 8 : k.age,
    weightLbs: k.lbs === undefined ? 62 : k.lbs,
    belt: k.belt === undefined ? 'grey' : k.belt,
    gender: k.gender ?? null, erp: k.erp ?? null, source: 'manual' as const,
  }))).returning().all()
  const id = new Map(kids.map((k, i) => [k.name, rows[i].id]))
  return { s, id: (name: string) => id.get(name)!, names: (p: { a: { firstName: string }; b: { firstName: string } }) => `${p.a.firstName} v ${p.b.firstName}` }
}

describe('pairCost', () => {
  const side = (o: Partial<Parameters<typeof pairCost>[0]> = {}) => ({ id: 1, age: 8, weightLbs: 62, belt: 'grey', erp: null, ...o })

  it('weighs the class ten, the year two, the belt a half, and the rating a tenth', () => {
    expect(pairCost(side(), side({ id: 2 }))).toBe(0)
    expect(pairCost(side(), side({ id: 2, weightLbs: 75 }))).toBe(10)
    expect(pairCost(side(), side({ id: 2, age: 10 }))).toBe(4)
    expect(pairCost(side(), side({ id: 2, belt: 'yellow' }))).toBe(0.5)
    expect(pairCost(side({ erp: 6.1 }), side({ id: 2, erp: 5.8 }))).toBeCloseTo(0.03, 5)
    expect(pairCost(side({ erp: 6.1 }), side({ id: 2, erp: null }))).toBe(0)
    expect(pairCost(side({ belt: 'grey', erp: 6.1 }), side({ id: 2, age: 9, weightLbs: 75, belt: 'yellow', erp: 5.1 })))
      .toBeCloseTo(10 + 2 + 0.5 + 0.1, 5)
  })

  it('counts a missing age or weight as no gap at all', () => {
    expect(pairCost(side({ age: null }), side({ id: 2, age: 12 }))).toBe(0)
    expect(pairCost(side({ weightLbs: null }), side({ id: 2, weightLbs: 130 }))).toBe(0)
    expect(pairCost(side({ belt: null }), side({ id: 2 }))).toBe(1)
  })
})

describe('pairWhy', () => {
  const side = (o: Partial<Parameters<typeof pairWhy>[0]> = {}) => ({ id: 1, age: 8, weightLbs: 62, belt: 'grey', erp: null, ...o })

  it('says the class then the age', () => {
    expect(pairWhy(side(), side({ id: 2 }))).toBe('same class, same age')
    expect(pairWhy(side(), side({ id: 2, age: 9 }))).toBe('same class, 1 year apart')
    expect(pairWhy(side(), side({ id: 2, age: 11 }))).toBe('same class, 3 years apart')
    expect(pairWhy(side(), side({ id: 2, weightLbs: 75 }))).toBe('1 class apart, same age')
    expect(pairWhy(side(), side({ id: 2, weightLbs: 85, age: 9 }))).toBe('2 classes apart, 1 year apart')
  })

  it('says what it can when a kid has no age or weight', () => {
    expect(pairWhy(side({ age: null }), side({ id: 2 }))).toBe('same class')
    expect(pairWhy(side({ weightLbs: null }), side({ id: 2, age: 9 }))).toBe('1 year apart')
    expect(pairWhy(side({ age: null, weightLbs: null }), side({ id: 2 }))).toBe('missing age or weight')
  })
})

describe('proposeMatches', () => {
  it('pairs across three teams, closest first, with the lower team first in the row', async () => {
    const db = await freshDb()
    const { s, id } = await pool(db, [
      { name: 'Ines', team: 'A', lbs: 62 },
      { name: 'Bruno', team: 'B', lbs: 64 },
      { name: 'Kai', team: 'C', lbs: 75 },
      { name: 'Nadia', team: 'A', lbs: 78, age: 9 },
    ])
    const out = await proposeMatches(db, s.eventId)
    expect(out.map(p => [p.a.firstName, p.b.firstName])).toEqual([['Ines', 'Bruno'], ['Nadia', 'Kai']])
    expect(out.map(p => p.cost)).toEqual([0, 2])
    expect(out.map(p => p.why)).toEqual(['same class, same age', 'same class, 1 year apart'])
    expect(out[0].a).toEqual({
      athleteId: id('Ines'), firstName: 'Ines', lastName: 'Vantel', teamId: s.teamA,
      age: 8, weightLbs: 62, weightClass: '62 to 70 lbs', belt: 'grey', erp: null,
    })
    expect(out.every(p => p.eventId === s.eventId && p.id > 0)).toBe(true)
  })

  it('breaks a tie on the lighter class, then on the athlete ids', async () => {
    const db = await freshDb()
    const { s } = await pool(db, [
      { name: 'Tomas', team: 'A', lbs: 75 },
      { name: 'Vik', team: 'B', lbs: 75 },
      { name: 'Sable', team: 'A', lbs: 50 },
      { name: 'Uma', team: 'B', lbs: 50 },
    ])
    expect((await proposeMatches(db, s.eventId)).map(p => [p.a.firstName, p.b.firstName]))
      .toEqual([['Sable', 'Uma'], ['Tomas', 'Vik']])

    const db2 = await freshDb()
    const two = await pool(db2, [
      { name: 'Omar', team: 'A' },
      { name: 'Priya', team: 'A' },
      { name: 'Rafa', team: 'B' },
    ])
    expect((await proposeMatches(db2, two.s.eventId)).map(p => [p.a.firstName, p.b.firstName])).toEqual([['Omar', 'Rafa']])
  })

  it('excludes a pair more than two classes apart and keeps one exactly two apart', async () => {
    const db = await freshDb()
    const { s } = await pool(db, [
      { name: 'Wren', team: 'A', lbs: 39 },
      { name: 'Xan', team: 'B', lbs: 62 },
    ])
    expect(await proposeMatches(db, s.eventId)).toEqual([])

    const db2 = await freshDb()
    const near = await pool(db2, [
      { name: 'Wren', team: 'A', lbs: 39 },
      { name: 'Xan', team: 'B', lbs: 50 },
    ])
    expect((await proposeMatches(db2, near.s.eventId)).map(p => p.why)).toEqual(['2 classes apart, same age'])
  })

  it('keeps the same-gender veto', async () => {
    const db = await freshDb()
    const { s } = await pool(db, [
      { name: 'Yara', team: 'A', gender: 'F' },
      { name: 'Zane', team: 'B', gender: 'M' },
      { name: 'Wilma', team: 'C', gender: 'f' },
    ])
    await db.update(events).set({ sameGender: true }).where(eq(events.id, s.eventId)).run()
    expect((await proposeMatches(db, s.eventId)).map(p => [p.a.firstName, p.b.firstName])).toEqual([['Yara', 'Wilma']])
  })

  it('skips a kid with a pending match and frees one whose match is done', async () => {
    const db = await freshDb()
    const { s, id } = await pool(db, [
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B' },
      { name: 'Kai', team: 'C' },
    ])
    const match = await db.insert(matches).values({
      eventId: s.eventId, orderIndex: 0, rulesetId: s.rulesetId, lengthSec: 300,
      athleteAId: id('Ines'), athleteBId: id('Kai'),
    }).returning().get()
    expect(await proposeMatches(db, s.eventId)).toEqual([])

    await db.update(matches).set({ status: 'done' }).where(eq(matches.id, match.id)).run()
    // Ines and Kai are free again, but they have met, so the only pair left is Bruno's.
    expect((await proposeMatches(db, s.eventId)).map(p => [p.a.firstName, p.b.firstName])).toEqual([['Ines', 'Bruno']])
  })

  it('never pairs two kids who already met in this event', async () => {
    const db = await freshDb()
    const { s, id } = await pool(db, [
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B' },
    ])
    await db.insert(matches).values({
      eventId: s.eventId, orderIndex: 0, rulesetId: s.rulesetId, lengthSec: 300, status: 'done',
      athleteAId: id('Bruno'), athleteBId: id('Ines'),
    }).run()
    expect(await proposeMatches(db, s.eventId)).toEqual([])
  })

  it('leaves out a kid with no team, no age, or no weight', async () => {
    const db = await freshDb()
    const { s, id } = await pool(db, [
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B', age: null },
      { name: 'Kai', team: 'C', lbs: null },
      { name: 'Nadia', team: 'B' },
    ])
    await db.update(athletes).set({ teamId: null }).where(eq(athletes.id, id('Nadia'))).run()
    expect(await proposeMatches(db, s.eventId)).toEqual([])
  })

  it('replaces the drafts, leaves the matches alone, and audits once a run', async () => {
    const db = await freshDb()
    const { s, id } = await pool(db, [
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B' },
      { name: 'Kai', team: 'C' },
    ])
    const first = await proposeMatches(db, s.eventId)
    expect(first).toHaveLength(1)
    const second = await proposeMatches(db, s.eventId)
    expect(second.map(p => [p.a.athleteId, p.b.athleteId])).toEqual(first.map(p => [p.a.athleteId, p.b.athleteId]))
    expect(second[0].id).not.toBe(first[0].id)
    expect(await db.select().from(proposals).where(eq(proposals.eventId, s.eventId)).all()).toHaveLength(1)

    const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).all()
    expect(rows.map(r => r.action)).toEqual(['propose', 'propose'])
    expect(rows[0].detail).toEqual({ count: 1, unmatched: 1 })
    expect(rows.every(r => r.actor === 'admin' && r.matchId === null)).toBe(true)
    // Nothing the proposer does touches the running order.
    expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toEqual([])
    expect(id('Ines')).toBeGreaterThan(0)
  })
})
