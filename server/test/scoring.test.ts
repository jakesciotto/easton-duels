import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call, matToken } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { events, mats } from '../src/db/schema.js'
import { endMatch } from '../src/match/events.js'

describe('bind and heartbeat', () => {
  // A mat token is a write credential. In a desk event the desk is already typing the
  // results, so a second writer would fight it over the same matches. The tablet refuses
  // too, but that guard is advisory: a stale tab or a bookmarked link reaches the endpoint
  // without it.
  it('refuses a bind on an event that runs from the desk, after checking the code', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    await db.update(events).set({ mode: 'entry' }).where(eq(events.id, s.eventId)).run()

    // A wrong code still fails as a wrong code, so an unauthenticated caller learns nothing
    // about how the event is run.
    const bad = await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '9999' })
    expect(bad.status).toBe(401)

    const refused = await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('desk_mode')
    expect(refused.body.error.message).toMatch(/runs from the desk/)

    // Switching back hands out a token again, because the desk path is a fallback rather
    // than a one way door.
    await db.update(events).set({ mode: 'live' }).where(eq(events.id, s.eventId)).run()
    expect((await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })).status).toBe(200)
  })

  it('issues a mat token for the right code and locks after twenty failed codes', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const bad = await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '9999' })
    expect(bad.status).toBe(401)
    const ok = await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })
    expect(ok.status).toBe(200)
    expect(ok.body.mat).toEqual({ id: s.matIds[0], number: 1 })
    const hb = await call(app, 'POST', `/api/mats/${s.matIds[0]}/heartbeat`, {}, ok.body.token)
    expect(hb.status).toBe(200)
    expect((await call(app, 'POST', `/api/mats/${s.matIds[1]}/heartbeat`, {}, ok.body.token)).status).toBe(403)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.snapshot.mats[0].bound).toBe(true)
    for (let i = 0; i < 18; i++) await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '9999' })
    // Nineteen wrong codes so far, and the correct ones in between never spent the budget.
    expect((await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420', takeOver: true })).status).toBe(200)
    await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '9999' })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })).status).toBe(429)
  })

  it('refuses a second tablet on a bound mat and hands the mat over on request', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const bind = `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`
    const first = await call(app, 'POST', bind, { code: '0420' })
    expect(first.status).toBe(200)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.snapshot.mats[0].bound).toBe(true)

    const second = await call(app, 'POST', bind, { code: '0420' })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('mat_bound')
    expect(second.body.error.message).toMatch(/already has an iPad/)

    const taken = await call(app, 'POST', bind, { code: '0420', takeOver: true })
    expect(taken.status).toBe(200)
    expect(taken.body.token).not.toBe(first.body.token)

    const stale = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/events`, { id: 'stale-0001', type: 'clock_start', lastSeq: 0 }, first.body.token)
    expect(stale.status).toBe(401)
    expect(stale.body.error.code).toBe('token_stale')
    expect((await call(app, 'POST', `/api/mats/${s.matIds[0]}/heartbeat`, {}, first.body.token)).status).toBe(401)

    const fresh = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/events`, { id: 'fresh-0001', type: 'clock_start', lastSeq: 0 }, taken.body.token)
    expect(fresh.status).toBe(200)
  })

  it('lets a tablet bind a mat whose scorer stopped answering', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const bind = `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`
    expect((await call(app, 'POST', bind, { code: '0420' })).status).toBe(200)
    await db.update(mats).set({ lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() }).where(eq(mats.id, s.matIds[0])).run()
    expect((await call(app, 'POST', bind, { code: '0420' })).status).toBe(200)
  })

  it('answers 404 for an unknown event or an unknown mat', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const noEvent = await call(app, 'POST', `/api/events/999/mats/${s.matIds[0]}/bind`, { code: '0420' })
    expect(noEvent.status).toBe(404)
    expect(noEvent.body.error.code).toBe('not_found')
    const noMat = await call(app, 'POST', `/api/events/${s.eventId}/mats/999/bind`, { code: '0420' })
    expect(noMat.status).toBe(404)
    expect(noMat.body.error.code).toBe('not_found')
  })
})

describe('scoring flow', () => {
  it('scores, dedupes, rejects stale seq, undoes, and ends with mat advance', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const [first, second] = s.matchIds
    const base = `/api/matches/${first}`

    let r = await call(app, 'POST', `${base}/events`, { id: 'evt-0001', type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 }, token)
    expect(r.status).toBe(200)
    expect(r.body.match.a.score).toBe(2)
    expect(r.body.match.lastSeq).toBe(1)
    const v1 = r.body.version

    r = await call(app, 'POST', `${base}/events`, { id: 'evt-0001', type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 }, token)
    expect(r.status).toBe(200)
    expect(r.body.match.a.score).toBe(2)
    expect(r.body.version).toBe(v1)

    r = await call(app, 'POST', `${base}/events`, { id: 'evt-0002', type: 'score', athleteId: s.b1, actionKey: 'sweep', lastSeq: 0 }, token)
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('sequence')
    expect(r.body.error.currentSeq).toBe(1)
    expect(r.body.error.match.lastSeq).toBe(1)

    r = await call(app, 'POST', `${base}/events`, { id: 'evt-0002', type: 'score', athleteId: s.b1, actionKey: 'sweep', lastSeq: 1 }, token)
    expect(r.body.match.b.score).toBe(2)
    r = await call(app, 'DELETE', `${base}/events/last`, { lastSeq: 2 }, token)
    expect(r.body.match.b.score).toBe(0)
    expect(r.body.match.lastSeq).toBe(1)

    r = await call(app, 'POST', `${base}/end`, { id: 'end-0001', lastSeq: 1 }, token)
    expect(r.status).toBe(200)
    expect(r.body.match.status).toBe('done')
    expect(r.body.match.result).toEqual({ winnerAthleteId: s.a1, winType: 'points' })
    const board = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(board.body.snapshot.mats[0].current.id).toBe(second)
    expect(board.body.snapshot.teams[0].wins).toBe(1)
  })

  it('advances the mat on a replayed end whose advance never landed', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const [first, second] = s.matchIds
    const body = { id: 'end-0001', lastSeq: 0, winnerAthleteId: s.a1 }
    await endMatch(db, { ...body, matchId: first })
    const version = (await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.version
    const replay = await call(app, 'POST', `/api/matches/${first}/end`, body, token)
    expect(replay.status).toBe(200)
    // The replay advanced the mat, so it has to bump: a version pinned to the duplicate
    // flag would leave every poller short-circuiting on the finished match.
    expect(replay.body.version).toBe(version + 1)
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(second)
  })

  it('requires a decision on a tie and records a submission from a terminal', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const base = `/api/matches/${s.matchIds[0]}`
    let r = await call(app, 'POST', `${base}/end`, { id: 'end-0001', lastSeq: 0 }, token)
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('decision_required')
    r = await call(app, 'POST', `${base}/events`, { id: 'evt-0001', type: 'terminal', athleteId: s.b1, actionKey: 'pin', lastSeq: 0 }, token)
    expect(r.body.match.pendingTerminal).toEqual({ athleteId: s.b1, actionKey: 'pin' })
    r = await call(app, 'POST', `${base}/end`, { id: 'end-0002', lastSeq: 1 }, token)
    expect(r.body.match.result).toEqual({ winnerAthleteId: s.b1, winType: 'submission' })
  })

  it('runs the clock and lets clock_pause stop it', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const base = `/api/matches/${s.matchIds[0]}`
    const r = await call(app, 'POST', `${base}/events`, { id: 'clk-0001', type: 'clock_start', lastSeq: 0 }, token)
    expect(r.body.match.clock.startedAt).not.toBeNull()
    const p = await call(app, 'POST', `${base}/events`, { id: 'clk-0002', type: 'clock_pause', lastSeq: 1 }, token)
    expect(p.body.match.clock.startedAt).toBeNull()
  })

  it('blocks scoring while the event is in setup and with the wrong mat token', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const base = `/api/matches/${s.matchIds[0]}`
    const r = await call(app, 'POST', `${base}/events`, { id: 'evt-0001', type: 'clock_start', lastSeq: 0 }, matToken(s.eventId, s.matIds[0]))
    expect(r.status).toBe(409)
    expect((await call(app, 'POST', `${base}/events`, { id: 'evt-0002', type: 'clock_start', lastSeq: 0 }, matToken(s.eventId, s.matIds[1]))).status).toBe(403)
    expect((await call(app, 'POST', `${base}/events`, { id: 'evt-0003', type: 'clock_start', lastSeq: 0 })).status).toBe(401)
  })

  it('rejects a client event id outside the allowed charset', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const r = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/events`, { id: 'entry:0001', type: 'clock_start', lastSeq: 0 }, matToken(s.eventId, s.matIds[0]))
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('validation')
  })

  it('refuses added time while the clock is running and takes it once it stops', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const url = `/api/matches/${s.matchIds[0]}`
    await call(app, 'POST', `${url}/events`, { id: 'clk-0001', type: 'clock_start', lastSeq: 0 }, token)
    const running = await call(app, 'POST', `${url}/clock/extend`, { id: 'add-0001', lastSeq: 1, addMs: 60_000 }, token)
    expect(running.status).toBe(409)
    expect(running.body.error.code).toBe('match_state')
    await call(app, 'POST', `${url}/events`, { id: 'clk-0002', type: 'clock_pause', lastSeq: 1 }, token)
    const added = await call(app, 'POST', `${url}/clock/extend`, { id: 'add-0001', lastSeq: 2, addMs: 60_000 }, token)
    expect(added.status).toBe(200)
    const stale = await call(app, 'POST', `${url}/clock/extend`, { id: 'add-0002', lastSeq: 2, addMs: 60_000 }, token)
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({ code: 'sequence', currentSeq: 3 })
    expect((await call(app, 'POST', `${url}/clock/extend`, { id: 'add-0003', lastSeq: 3, addMs: 60_000 }, matToken(s.eventId, s.matIds[1]))).status).toBe(403)
  })

  it('admin can reopen and skip', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await call(app, 'POST', `/api/matches/${first}/end`, { id: 'end-0001', lastSeq: 0, winnerAthleteId: s.a1 }, adminToken)
    let r = await call(app, 'POST', `/api/matches/${first}/reopen`, undefined, adminToken)
    expect(r.body.match.status).toBe('live')
    expect((await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.snapshot.mats[0].current.id).toBe(first)
    r = await call(app, 'POST', `/api/matches/${first}/skip`, undefined, adminToken)
    expect(r.body.match.status).toBe('pending')
    expect((await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.snapshot.mats[0].current.id).toBe(second)
    expect((await call(app, 'POST', `/api/matches/${first}/skip`, undefined, matToken(s.eventId, s.matIds[0]))).status).toBe(403)
  })

  it('takes a double-fired skip once', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    const one = await call(app, 'POST', `/api/matches/${first}/skip`, { id: 'skip-0001' }, adminToken)
    const two = await call(app, 'POST', `/api/matches/${first}/skip`, { id: 'skip-0001' }, adminToken)
    expect(one.status).toBe(200)
    expect(two.status).toBe(200)
    expect(two.body.match.orderIndex).toBe(one.body.match.orderIndex)
    expect(two.body.version).toBe(one.body.version)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.snapshot.mats[0].current.id).toBe(second)

    expect((await call(app, 'POST', `/api/matches/${second}/skip`, { id: 'no' }, adminToken)).status).toBe(422)
  })
})

describe('unbind', () => {
  it('frees the mat at once so the same iPad can bind again without a takeover', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const bind = `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`
    const first = await call(app, 'POST', bind, { code: '0420' })
    expect(first.status).toBe(200)
    expect((await call(app, 'POST', `/api/mats/${s.matIds[0]}/unbind`, {}, first.body.token)).status).toBe(200)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.snapshot.mats[0].bound).toBe(false)
    // No takeover needed: the mat is free, not held by a silent tablet.
    const again = await call(app, 'POST', bind, { code: '0420' })
    expect(again.status).toBe(200)
    expect(again.body.token).not.toBe(first.body.token)
    // The token the tablet dropped is dead too.
    const stale = await call(app, 'POST', `/api/mats/${s.matIds[0]}/heartbeat`, {}, first.body.token)
    expect(stale.status).toBe(401)
    expect(stale.body.error.code).toBe('token_stale')
  })
})

describe('names on the wire', () => {
  it('serves initials on the public snapshot and full names to the console', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const pub = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(pub.body.snapshot.matches[0].a.name).toBe('Mateo R.')
    const admin = (await call(app, 'POST', '/api/auth/admin', { pin: '123456' })).body.token
    const full = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`, undefined, admin)
    expect(full.body.snapshot.matches[0].a.name).toBe('Mateo Rivera')
    const mat = (await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })).body.token
    const write = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/events`, { id: 'names-0001', type: 'clock_start', lastSeq: 0 }, mat)
    expect(write.status).toBe(200)
    expect(write.body.match.a.name).toBe('Mateo R.')
  })
})
