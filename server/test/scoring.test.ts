import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call, matToken } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { mats } from '../src/db/schema.js'
import { endMatch } from '../src/match/events.js'

describe('bind and heartbeat', () => {
  it('issues a mat token for the right code and locks after five bad codes', async () => {
    const { app, db } = createTestApp()
    const s = seedEvent(db)
    const bad = await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '9999' })
    expect(bad.status).toBe(401)
    const ok = await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })
    expect(ok.status).toBe(200)
    expect(ok.body.mat).toEqual({ id: s.matIds[0], number: 1 })
    const hb = await call(app, 'POST', `/api/mats/${s.matIds[0]}/heartbeat`, {}, ok.body.token)
    expect(hb.status).toBe(200)
    expect((await call(app, 'POST', `/api/mats/${s.matIds[1]}/heartbeat`, {}, ok.body.token)).status).toBe(403)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/board`)).body.mats[0].bound).toBe(true)
    for (let i = 0; i < 4; i++) await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '9999' })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/mats/${s.matIds[0]}/bind`, { code: '0420' })).status).toBe(429)
  })
})

describe('scoring flow', () => {
  it('scores, dedupes, rejects stale seq, undoes, and ends with mat advance', async () => {
    const { app, db } = createTestApp()
    const s = seedEvent(db, { matCount: 1, live: true })
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
    const board = await call(app, 'GET', `/api/events/${s.eventId}/board`)
    expect(board.body.mats[0].current.id).toBe(second)
    expect(board.body.teams[0].wins).toBe(1)
  })

  it('advances the mat on a replayed end whose advance never landed', async () => {
    const { app, db } = createTestApp()
    const s = seedEvent(db, { matCount: 1, live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const [first, second] = s.matchIds
    const body = { id: 'end-0001', lastSeq: 0, winnerAthleteId: s.a1 }
    endMatch(db, { ...body, matchId: first })
    const version = (await call(app, 'GET', `/api/events/${s.eventId}/board`)).body.version
    const replay = await call(app, 'POST', `/api/matches/${first}/end`, body, token)
    expect(replay.status).toBe(200)
    expect(replay.body.version).toBe(version)
    expect(db.select().from(mats).where(eq(mats.id, s.matIds[0])).get()?.currentMatchId).toBe(second)
  })

  it('requires a decision on a tie and records a submission from a terminal', async () => {
    const { app, db } = createTestApp()
    const s = seedEvent(db, { live: true })
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

  it('runs the clock and lets the scheduler expire it', async () => {
    const { app, db, expiry } = createTestApp()
    const s = seedEvent(db, { live: true })
    const token = matToken(s.eventId, s.matIds[0])
    const base = `/api/matches/${s.matchIds[0]}`
    const r = await call(app, 'POST', `${base}/events`, { id: 'clk-0001', type: 'clock_start', lastSeq: 0 }, token)
    expect(r.body.match.clock.startedAt).not.toBeNull()
    expect(expiry.pendingCount()).toBe(1)
    const p = await call(app, 'POST', `${base}/events`, { id: 'clk-0002', type: 'clock_pause', lastSeq: 1 }, token)
    expect(p.body.match.clock.startedAt).toBeNull()
    expect(expiry.pendingCount()).toBe(0)
  })

  it('blocks scoring while the event is in setup and with the wrong mat token', async () => {
    const { app, db } = createTestApp()
    const s = seedEvent(db)
    const base = `/api/matches/${s.matchIds[0]}`
    const r = await call(app, 'POST', `${base}/events`, { id: 'evt-0001', type: 'clock_start', lastSeq: 0 }, matToken(s.eventId, s.matIds[0]))
    expect(r.status).toBe(409)
    expect((await call(app, 'POST', `${base}/events`, { id: 'evt-0002', type: 'clock_start', lastSeq: 0 }, matToken(s.eventId, s.matIds[1]))).status).toBe(403)
    expect((await call(app, 'POST', `${base}/events`, { id: 'evt-0003', type: 'clock_start', lastSeq: 0 })).status).toBe(401)
  })

  it('admin can reopen, edit the result, and skip', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await call(app, 'POST', `/api/matches/${first}/end`, { id: 'end-0001', lastSeq: 0, winnerAthleteId: s.a1 }, adminToken)
    let r = await call(app, 'POST', `/api/matches/${first}/result`, { winnerAthleteId: s.b1, winType: 'decision' }, adminToken)
    expect(r.body.match.result).toEqual({ winnerAthleteId: s.b1, winType: 'decision' })
    r = await call(app, 'POST', `/api/matches/${first}/reopen`, undefined, adminToken)
    expect(r.body.match.status).toBe('live')
    expect((await call(app, 'GET', `/api/events/${s.eventId}/board`)).body.mats[0].current.id).toBe(first)
    r = await call(app, 'POST', `/api/matches/${first}/skip`, undefined, adminToken)
    expect(r.body.match.status).toBe('pending')
    expect((await call(app, 'GET', `/api/events/${s.eventId}/board`)).body.mats[0].current.id).toBe(second)
    expect((await call(app, 'POST', `/api/matches/${first}/skip`, undefined, matToken(s.eventId, s.matIds[0]))).status).toBe(403)
  })
})
