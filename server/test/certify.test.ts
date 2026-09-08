import { describe, it, expect } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createTestApp, call, matToken, TEST_PIN } from './helpers.js'
import { seedEvent, type Seeded } from './fixtures.js'
import type { Db } from '../src/db/client.js'
import { auditLog, events } from '../src/db/schema.js'
import { CERTIFIED_MESSAGE } from '../src/audit/certify.js'

type App = Awaited<ReturnType<typeof createTestApp>>['app']

// One certified event with a settled match, which is the state the pilot ends the
// afternoon in.
async function certified(): Promise<{ app: App; db: Db; adminToken: string; s: Seeded }> {
  const { app, db, adminToken } = await createTestApp()
  const s = await seedEvent(db, { matCount: 1, live: true })
  await call(app, 'POST', `/api/matches/${s.matchIds[0]}/end`, { id: 'end-0001', lastSeq: 0, winnerAthleteId: s.a1 }, adminToken)
  await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'done' }, adminToken)
  const r = await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: TEST_PIN }, adminToken)
  expect(r.status).toBe(200)
  expect(r.body.event.status).toBe('certified')
  return { app, db, adminToken, s }
}

interface Write { name: string; method: string; path: (s: Seeded) => string; body?: (s: Seeded) => unknown; mat?: boolean }

// Every write route the server has, minus the two that certification deliberately leaves
// open (heartbeat and unbind) and the two that manage certification itself. A route added
// without a guard fails here rather than at the gym.
const WRITES: Write[] = [
  { name: 'scoring event', method: 'POST', path: s => `/api/matches/${s.matchIds[0]}/events`, body: s => ({ id: 'score-0002', type: 'score', athleteId: s.a1, actionKey: 'mount', lastSeq: 2 }), mat: true },
  { name: 'undo', method: 'DELETE', path: s => `/api/matches/${s.matchIds[0]}/events/last`, body: () => ({ lastSeq: 2 }), mat: true },
  { name: 'end', method: 'POST', path: s => `/api/matches/${s.matchIds[0]}/end`, body: () => ({ id: 'end-0002', lastSeq: 2 }), mat: true },
  { name: 'clock extend', method: 'POST', path: s => `/api/matches/${s.matchIds[0]}/clock/extend`, body: () => ({ id: 'add-0001', lastSeq: 2, addMs: 60_000 }), mat: true },
  { name: 'reopen', method: 'POST', path: s => `/api/matches/${s.matchIds[0]}/reopen` },
  { name: 'skip', method: 'POST', path: s => `/api/matches/${s.matchIds[1]}/skip`, body: () => ({ id: 'skip-0001' }) },
  { name: 'entry on a match', method: 'POST', path: s => `/api/matches/${s.matchIds[0]}/entry`, body: s => ({ entryId: 'entry-0001', pointsA: 1, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }) },
  { name: 'entry for a pair', method: 'POST', path: s => `/api/events/${s.eventId}/entries`, body: s => ({ entryId: 'entry-0002', athleteAId: s.a2, athleteBId: s.b2, pointsA: 1, pointsB: 0, winnerAthleteId: s.a2, winType: 'points' }) },
  { name: 'bind', method: 'POST', path: s => `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, body: () => ({ code: '0420' }) },
  { name: 'advance', method: 'POST', path: s => `/api/mats/${s.matIds[0]}/advance` },
  { name: 'event patch', method: 'PATCH', path: s => `/api/events/${s.eventId}`, body: () => ({ name: 'Renamed' }) },
  { name: 'event delete', method: 'DELETE', path: s => `/api/events/${s.eventId}` },
  { name: 'team patch', method: 'PATCH', path: s => `/api/events/${s.eventId}/teams/${s.teamA}`, body: () => ({ name: 'Renamed' }) },
  { name: 'ruleset create', method: 'POST', path: s => `/api/events/${s.eventId}/rulesets`, body: () => ({ name: 'Short', defaultLengthSec: 120, actions: [{ key: 'takedown', label: 'Takedown', points: 2 }], terminals: [] }) },
  { name: 'ruleset patch', method: 'PATCH', path: s => `/api/rulesets/${s.rulesetId}`, body: () => ({ name: 'Renamed' }) },
  { name: 'ruleset delete', method: 'DELETE', path: s => `/api/rulesets/${s.rulesetId}` },
  { name: 'athlete add', method: 'POST', path: s => `/api/events/${s.eventId}/athletes`, body: () => ({ manual: { firstName: 'Rowan', lastName: 'Vale' } }) },
  { name: 'athlete patch', method: 'PATCH', path: s => `/api/athletes/${s.a1}`, body: () => ({ weightLbs: 64 }) },
  { name: 'athlete assign', method: 'POST', path: s => `/api/events/${s.eventId}/athletes/assign`, body: s => ({ ids: [s.a1], teamId: s.teamB }) },
  { name: 'athlete delete', method: 'DELETE', path: s => `/api/athletes/${s.a1}` },
  { name: 'roster sync', method: 'POST', path: s => `/api/events/${s.eventId}/roster/sync`, body: () => ({ kBusinesses: ['1'] }) },
  { name: 'match generate', method: 'POST', path: s => `/api/events/${s.eventId}/matches/generate` },
  { name: 'match create', method: 'POST', path: s => `/api/events/${s.eventId}/matches`, body: s => ({ athleteAId: s.a1, athleteBId: s.b2 }) },
  { name: 'match patch', method: 'PATCH', path: s => `/api/matches/${s.matchIds[1]}`, body: () => ({ lengthSec: 240 }) },
  { name: 'match delete', method: 'DELETE', path: s => `/api/matches/${s.matchIds[1]}` },
  { name: 'match reorder', method: 'POST', path: s => `/api/events/${s.eventId}/matches/reorder`, body: s => ({ ids: [...s.matchIds].reverse() }) },
]

describe('certification locks the event', () => {
  it.each(WRITES.map(w => [w.name, w] as const))('refuses %s', async (_name, w) => {
    const { app, adminToken, s } = await certified()
    const token = w.mat ? matToken(s.eventId, s.matIds[0]) : adminToken
    const r = await call(app, w.method, w.path(s), w.body?.(s), token)
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('match_state')
    expect(r.body.error.message).toBe(CERTIFIED_MESSAGE)
  })

  it.each(WRITES.map(w => [w.name, w] as const))('lets %s through again after an unlock', async (_name, w) => {
    const { app, adminToken, s } = await certified()
    const unlocked = await call(app, 'POST', `/api/events/${s.eventId}/uncertify`, { pin: TEST_PIN, reason: 'wrong winner on mat 1' }, adminToken)
    expect(unlocked.status).toBe(200)
    const token = w.mat ? matToken(s.eventId, s.matIds[0]) : adminToken
    const r = await call(app, w.method, w.path(s), w.body?.(s), token)
    // Some of these still refuse for their own reasons on a finished event, which is the
    // state an unlock returns to. What must be gone is the certification refusal.
    expect(r.body?.error?.message).not.toBe(CERTIFIED_MESSAGE)
  })

  /**
   * An unlock returns the event to done, and done has refused a typed result since the
   * batch that added Finish: the board has already announced the final score. So an
   * unlock reopens the roster, the match list and the rulesets, which Finish never
   * locked, and a result still has to be fixed before Finish. Recorded here because the
   * two rules are easy to mistake for one, and because the second one is a ruling
   * (batch 1) rather than an oversight.
   */
  it('reopens what Finish never locked, and leaves the finished-event rule standing', async () => {
    const { app, adminToken, s } = await certified()
    await call(app, 'POST', `/api/events/${s.eventId}/uncertify`, { pin: TEST_PIN, reason: 'mat 1 winner was wrong' }, adminToken)
    const reordered = await call(app, 'POST', `/api/events/${s.eventId}/matches/reorder`, { ids: [...s.matchIds].reverse() }, adminToken)
    expect(reordered.status).toBe(200)
    expect((await call(app, 'PATCH', `/api/athletes/${s.a1}`, { weightLbs: 64 }, adminToken)).status).toBe(200)
    const fixed = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, {
      entryId: 'entry-0009', pointsA: 0, pointsB: 4, winnerAthleteId: s.b1, winType: 'points',
    }, adminToken)
    expect(fixed.status).toBe(409)
    expect(fixed.body.error.message).toBe('event is done')
  })

  it('keeps the heartbeat and the unbind open, and takes the mat back', async () => {
    const { app, s } = await certified()
    const token = matToken(s.eventId, s.matIds[0])
    expect((await call(app, 'POST', `/api/mats/${s.matIds[0]}/heartbeat`, {}, token)).status).toBe(200)
    expect((await call(app, 'POST', `/api/mats/${s.matIds[0]}/unbind`, {}, token)).status).toBe(200)
  })
})

describe('certify and uncertify', () => {
  it('carries certifiedAt on the snapshot and the detail, and records both writes', async () => {
    const { app, db, adminToken, s } = await certified()
    const detail = await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)
    expect(typeof detail.body.event.certifiedAt).toBe('string')
    const snap = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(snap.body.snapshot.event.status).toBe('certified')
    expect(snap.body.snapshot.event.certifiedAt).toBe(detail.body.event.certifiedAt)

    const unlocked = await call(app, 'POST', `/api/events/${s.eventId}/uncertify`, { pin: TEST_PIN, reason: 'mat 2 result was typed twice' }, adminToken)
    expect(unlocked.status).toBe(200)
    expect(unlocked.body.event.status).toBe('done')
    expect(unlocked.body.event.certifiedAt).toBeNull()

    const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).orderBy(asc(auditLog.id)).all()
    const both = rows.filter(r => r.action === 'certify' || r.action === 'uncertify')
    expect(both.map(r => `${r.actor} ${r.action}`)).toEqual(['admin certify', 'admin uncertify'])
    expect(both[1].detail).toMatchObject({ reason: 'mat 2 result was typed twice' })
  })

  it('asks for the PIN again and rate limits a guesser', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'done' }, adminToken)
    const wrong = await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: '000000' }, adminToken)
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('bad_pin')
    expect((await db.select().from(events).where(eq(events.id, s.eventId)).get())?.status).toBe('done')
    for (let i = 0; i < 9; i++) await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: '000000' }, adminToken)
    const limited = await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: TEST_PIN }, adminToken)
    expect(limited.status).toBe(429)
  })

  it('certifies a finished event only, and unlocks a certified one only', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const early = await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: TEST_PIN }, adminToken)
    expect(early.status).toBe(409)
    expect(early.body.error.message).toMatch(/only a finished event/)
    await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'done' }, adminToken)
    const open = await call(app, 'POST', `/api/events/${s.eventId}/uncertify`, { pin: TEST_PIN, reason: 'nothing to unlock' }, adminToken)
    expect(open.status).toBe(409)
    expect(open.body.error.message).toMatch(/only a certified event/)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: TEST_PIN }, adminToken)).status).toBe(200)
    const noReason = await call(app, 'POST', `/api/events/${s.eventId}/uncertify`, { pin: TEST_PIN }, adminToken)
    expect(noReason.status).toBe(422)
    const longReason = await call(app, 'POST', `/api/events/${s.eventId}/uncertify`, { pin: TEST_PIN, reason: 'x'.repeat(121) }, adminToken)
    expect(longReason.status).toBe(422)
  })

  it('needs an admin token, and 404s an unknown event', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: TEST_PIN })).status).toBe(401)
    expect((await call(app, 'POST', '/api/events/999/certify', { pin: TEST_PIN }, adminToken)).status).toBe(404)
  })
})
