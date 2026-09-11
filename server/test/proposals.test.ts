import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'
import type { Db } from '../src/db/client.js'
import { athletes, auditLog, matches, proposals, rulesets } from '../src/db/schema.js'

interface Kid { name: string; team: 'A' | 'B' | 'C'; age?: number; lbs?: number }

// One pool over three teams, written straight into the roster so each test states the
// exact kids the proposer is going to see.
async function pool(kids: Kid[]) {
  const { app, db, adminToken } = await createTestApp()
  const s = await seedEvent(db, { matCount: 2, matches: 0, thirdTeam: true })
  await db.delete(athletes).where(eq(athletes.eventId, s.eventId)).run()
  const teamOf = { A: s.teamA, B: s.teamB, C: s.teamC! }
  const rows = await db.insert(athletes).values(kids.map(k => ({
    eventId: s.eventId, teamId: teamOf[k.team], firstName: k.name, lastName: 'Vantel',
    age: k.age ?? 8, weightLbs: k.lbs ?? 62, belt: 'grey', source: 'manual' as const,
  }))).returning().all()
  const id = (name: string) => rows[kids.findIndex(k => k.name === name)].id
  return { app, db, adminToken, s, id }
}

const THREE: Kid[] = [
  { name: 'Ines', team: 'A', lbs: 62 },
  { name: 'Bruno', team: 'B', lbs: 64 },
  { name: 'Kai', team: 'C', lbs: 130 },
  { name: 'Nadia', team: 'A', lbs: 128 },
]

async function pending(db: Db, eventId: number, rulesetId: number, aId: number, bId: number) {
  await db.insert(matches).values({
    eventId, orderIndex: 99, rulesetId, lengthSec: 300, athleteAId: aId, athleteBId: bId,
  }).run()
}

describe('proposing', () => {
  it('answers the drafts in cost order and reads them back', async () => {
    const { app, adminToken, s, id } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    expect(made.status).toBe(200)
    expect(made.body.map((p: any) => [p.a.athleteId, p.b.athleteId])).toEqual([[id('Ines'), id('Bruno')], [id('Nadia'), id('Kai')]])
    expect(made.body[0]).toMatchObject({ eventId: s.eventId, cost: 0, why: 'same class, same age' })
    expect(made.body[0].a).toMatchObject({ firstName: 'Ines', lastName: 'Vantel', teamId: s.teamA, weightClass: '62 to 70 lbs' })

    const read = await call(app, 'GET', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    expect(read.status).toBe(200)
    expect(read.body).toEqual(made.body)
  })

  it('needs an admin token and a real event', async () => {
    const { app, adminToken, s } = await pool(THREE)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/proposals`)).status).toBe(401)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/proposals`)).status).toBe(401)
    expect((await call(app, 'POST', '/api/events/9999/proposals', undefined, adminToken)).status).toBe(404)
    expect((await call(app, 'GET', '/api/events/9999/proposals', undefined, adminToken)).status).toBe(404)
  })
})

describe('confirming', () => {
  it('creates the match the Add match dialog would, and drops the draft', async () => {
    const { app, db, adminToken, s, id } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    const first = made.body[0]

    const confirmed = await call(app, 'POST', `/api/proposals/${first.id}/confirm`, undefined, adminToken)
    expect(confirmed.status).toBe(201)
    expect(confirmed.body.match).toMatchObject({
      eventId: s.eventId, athleteAId: id('Ines'), athleteBId: id('Bruno'),
      rulesetId: s.rulesetId, lengthSec: 300, orderIndex: 0, status: 'pending', source: 'proposed',
    })
    expect(confirmed.body.match.matId).not.toBeNull()
    expect(await db.select().from(proposals).where(eq(proposals.id, first.id)).get()).toBeUndefined()
    expect(await db.select().from(proposals).where(eq(proposals.eventId, s.eventId)).all()).toHaveLength(1)

    const audit = await db.select().from(auditLog)
      .where(and(eq(auditLog.eventId, s.eventId), eq(auditLog.matchId, confirmed.body.match.id))).all()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'match_create', actor: 'admin' })
    expect(audit[0].detail).toMatchObject({ athleteAId: id('Ines'), athleteBId: id('Bruno'), source: 'proposed' })
  })

  it('refuses an event with no ruleset, and 404s an unknown draft', async () => {
    const { app, db, adminToken, s } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    await db.delete(rulesets).where(eq(rulesets.eventId, s.eventId)).run()
    const refused = await call(app, 'POST', `/api/proposals/${made.body[0].id}/confirm`, undefined, adminToken)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('match_state')
    expect(refused.body.error.message).toBe('event needs a ruleset')
    expect((await call(app, 'POST', '/api/proposals/9999/confirm', undefined, adminToken)).status).toBe(404)
    expect((await call(app, 'POST', `/api/proposals/${made.body[0].id}/confirm`)).status).toBe(401)
  })

  it('refuses a draft whose kid was given a match by hand', async () => {
    const { app, db, adminToken, s, id } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    // The pool moved on under the draft: the organizer added this pair by hand.
    const added = await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: id('Ines'), athleteBId: id('Kai') }, adminToken)
    expect(added.status).toBe(201)

    const refused = await call(app, 'POST', `/api/proposals/${made.body[0].id}/confirm`, undefined, adminToken)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('match_state')
    expect(refused.body.error.message).toBe('Ines Vantel already has a match')
    // The draft is left for the organizer to swap or remove, and nothing was written.
    expect(await db.select().from(proposals).where(eq(proposals.id, made.body[0].id)).get()).toBeDefined()
    expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(1)
  })

  it('confirms what it can and counts the drafts it left behind', async () => {
    const { app, db, adminToken, s, id } = await pool([
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B' },
      { name: 'Kai', team: 'C' },
      { name: 'Nadia', team: 'A' },
      { name: 'Pilar', team: 'B' },
    ])
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    expect(made.body.map((p: any) => [p.a.firstName, p.b.firstName])).toEqual([['Ines', 'Bruno'], ['Nadia', 'Kai']])
    // Pilar is in no draft, so this hand-added match makes the first draft stale and
    // leaves the second one alone.
    expect((await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: id('Ines'), athleteBId: id('Pilar') }, adminToken)).status).toBe(201)

    const all = await call(app, 'POST', `/api/events/${s.eventId}/proposals/confirm-all`, undefined, adminToken)
    expect(all.status).toBe(201)
    expect(all.body).toEqual({ created: 1, skipped: 1 })
    const left = await db.select().from(proposals).where(eq(proposals.eventId, s.eventId)).all()
    expect(left.map(p => p.id)).toEqual([made.body[0].id])
    const rows = await db.select().from(matches).where(eq(matches.eventId, s.eventId)).orderBy(matches.orderIndex).all()
    expect(rows.map(m => [m.athleteAId, m.athleteBId, m.source])).toEqual([
      [id('Ines'), id('Pilar'), 'designed'],
      [id('Nadia'), id('Kai'), 'proposed'],
    ])
  })

  it('confirms every draft in cost order and empties the panel', async () => {
    const { app, db, adminToken, s, id } = await pool([
      { name: 'Ines', team: 'A', lbs: 62, age: 11 },
      { name: 'Bruno', team: 'B', lbs: 64, age: 8 },
      { name: 'Kai', team: 'C', lbs: 130 },
      { name: 'Nadia', team: 'A', lbs: 128 },
    ])
    await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    const all = await call(app, 'POST', `/api/events/${s.eventId}/proposals/confirm-all`, undefined, adminToken)
    expect(all.status).toBe(201)
    expect(all.body).toEqual({ created: 2, skipped: 0 })
    // Nadia and Kai cost nothing; Ines and Bruno are three years apart, so they go second.
    const rows = await db.select().from(matches).where(eq(matches.eventId, s.eventId)).orderBy(matches.orderIndex).all()
    expect(rows.map(m => [m.athleteAId, m.athleteBId])).toEqual([[id('Nadia'), id('Kai')], [id('Ines'), id('Bruno')]])
    expect(rows.every(m => m.source === 'proposed')).toBe(true)
    expect(await db.select().from(proposals).where(eq(proposals.eventId, s.eventId)).all()).toEqual([])
    expect((await call(app, 'POST', `/api/events/${s.eventId}/proposals/confirm-all`, undefined, adminToken)).body).toEqual({ created: 0, skipped: 0 })
    expect((await call(app, 'POST', '/api/events/9999/proposals/confirm-all', undefined, adminToken)).status).toBe(404)
  })
})

describe('swapping a kid into a draft', () => {
  it('takes the new kid, drops their other draft, and says what is odd about the pair', async () => {
    const { app, db, adminToken, s, id } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    const [first, second] = made.body

    const swapped = await call(app, 'PATCH', `/api/proposals/${first.id}`, { athleteBId: id('Kai') }, adminToken)
    expect(swapped.status).toBe(200)
    expect(swapped.body.proposal).toMatchObject({ id: first.id, cost: 60, why: '6 classes apart, same age' })
    expect([swapped.body.proposal.a.athleteId, swapped.body.proposal.b.athleteId]).toEqual([id('Ines'), id('Kai')])
    expect(swapped.body.removed).toEqual([second.id])
    expect(swapped.body.warnings).toEqual(['6 weight classes apart'])
    expect(await db.select().from(proposals).where(eq(proposals.eventId, s.eventId)).all()).toHaveLength(1)
  })

  it('warns about an age gap and a rematch without blocking either', async () => {
    const { app, db, adminToken, s, id } = await pool([
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B' },
      { name: 'Kai', team: 'C', age: 14 },
    ])
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    await db.insert(matches).values({
      eventId: s.eventId, orderIndex: 50, rulesetId: s.rulesetId, lengthSec: 300, status: 'done',
      athleteAId: id('Ines'), athleteBId: id('Kai'),
    }).run()
    const swapped = await call(app, 'PATCH', `/api/proposals/${made.body[0].id}`, { athleteBId: id('Kai') }, adminToken)
    expect(swapped.status).toBe(200)
    expect(swapped.body.warnings).toEqual(['6 years apart', 'Already met'])
    expect(swapped.body.removed).toEqual([])
  })

  it('refuses a kid who already has a match, a team mate, and a kid off the event', async () => {
    const { app, db, adminToken, s, id } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    const first = made.body[0]
    await pending(db, s.eventId, s.rulesetId, id('Kai'), id('Nadia'))

    const busy = await call(app, 'PATCH', `/api/proposals/${first.id}`, { athleteBId: id('Kai') }, adminToken)
    expect(busy.status).toBe(409)
    expect(busy.body.error.code).toBe('match_state')
    expect(busy.body.error.message).toBe('already has a match')

    const mate = await call(app, 'PATCH', `/api/proposals/${first.id}`, { athleteBId: id('Ines') }, adminToken)
    expect(mate.status).toBe(422)
    const off = await call(app, 'PATCH', `/api/proposals/${first.id}`, { athleteAId: 9999 }, adminToken)
    expect(off.status).toBe(422)
    const empty = await call(app, 'PATCH', `/api/proposals/${first.id}`, {}, adminToken)
    expect(empty.status).toBe(422)
    expect((await call(app, 'PATCH', '/api/proposals/9999', { athleteAId: id('Ines') }, adminToken)).status).toBe(404)
    // Nothing moved: the draft is the pair the proposer wrote.
    const row = await db.select().from(proposals).where(eq(proposals.id, first.id)).get()
    expect([row?.athleteAId, row?.athleteBId]).toEqual([id('Ines'), id('Bruno')])
  })

  it('does not treat a kid already in the draft as one coming in', async () => {
    const { app, db, adminToken, s, id } = await pool([
      { name: 'Ines', team: 'A' },
      { name: 'Bruno', team: 'B' },
      { name: 'Kai', team: 'C' },
      { name: 'Dalia', team: 'B' },
    ])
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    expect(made.body.map((p: any) => [p.a.firstName, p.b.firstName])).toEqual([['Ines', 'Bruno'], ['Dalia', 'Kai']])
    await pending(db, s.eventId, s.rulesetId, id('Ines'), id('Kai'))

    // The console sends both sides back. Ines has a match now, but she is not the kid
    // coming in, so the swap stands.
    const swapped = await call(app, 'PATCH', `/api/proposals/${made.body[0].id}`, { athleteAId: id('Ines'), athleteBId: id('Dalia') }, adminToken)
    expect(swapped.status).toBe(200)
    expect([swapped.body.proposal.a.athleteId, swapped.body.proposal.b.athleteId]).toEqual([id('Ines'), id('Dalia')])
    expect(swapped.body.removed).toEqual([made.body[1].id])
  })

  it('swaps the other side, and puts the lower team first whichever side moved', async () => {
    const { app, adminToken, s, id } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    const second = made.body[1]
    expect([second.a.athleteId, second.b.athleteId]).toEqual([id('Nadia'), id('Kai')])
    const swapped = await call(app, 'PATCH', `/api/proposals/${second.id}`, { athleteAId: id('Bruno') }, adminToken)
    expect(swapped.status).toBe(200)
    expect([swapped.body.proposal.a.athleteId, swapped.body.proposal.b.athleteId]).toEqual([id('Bruno'), id('Kai')])
  })
})

describe('removing a draft', () => {
  it('answers 204 and leaves the rest alone', async () => {
    const { app, db, adminToken, s } = await pool(THREE)
    const made = await call(app, 'POST', `/api/events/${s.eventId}/proposals`, undefined, adminToken)
    expect((await call(app, 'DELETE', `/api/proposals/${made.body[0].id}`, undefined, adminToken)).status).toBe(204)
    expect(await db.select().from(proposals).where(eq(proposals.eventId, s.eventId)).all()).toHaveLength(1)
    expect((await call(app, 'DELETE', `/api/proposals/${made.body[0].id}`, undefined, adminToken)).status).toBe(404)
    expect((await call(app, 'DELETE', `/api/proposals/${made.body[1].id}`)).status).toBe(401)
  })
})
