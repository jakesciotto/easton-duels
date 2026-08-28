import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import { createTestApp, call } from './helpers.js'
import { enterResult, createEntry } from '../src/match/entry.js'
import { loadMatch, loadEvents, appendMatchEvent } from '../src/match/events.js'
import { mats, matches } from '../src/db/schema.js'

describe('enterResult', () => {
  it('fills a pending match, marks it done, and advances the mat', () => {
    const db = freshDb()
    const s = seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    const m = enterResult(db, first, { pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' })
    expect(m).toMatchObject({ status: 'done', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points', lastSeq: 3 })
    expect(loadEvents(db, first).map(e => e.type)).toEqual(['set_score', 'set_score', 'end'])
    expect(db.select().from(mats).where(eq(mats.id, s.matIds[0])).get()?.currentMatchId).toBe(second)
    expect(loadMatch(db, second).status).toBe('live')
  })

  it('takes a correction on a done match through edit_result', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    enterResult(db, s.matchIds[0], { pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' })
    const m = enterResult(db, s.matchIds[0], { pointsA: 2, pointsB: 2, winnerAthleteId: s.b1, winType: 'decision' })
    expect(m).toMatchObject({ status: 'done', pointsA: 2, pointsB: 2, winnerAthleteId: s.b1, winType: 'decision', lastSeq: 6 })
    expect(loadEvents(db, s.matchIds[0]).at(-1)?.type).toBe('admin')
  })

  it('pauses a running clock first and works on a setup event', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    appendMatchEvent(db, { id: 'c1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0 })
    const m = enterResult(db, s.matchIds[0], { pointsA: 0, pointsB: 0, winnerAthleteId: s.b1, winType: 'submission' })
    expect(m.clockStartedAt).toBeNull()
    expect(loadEvents(db, s.matchIds[0]).map(e => e.type)).toEqual(['clock_start', 'clock_pause', 'set_score', 'set_score', 'end'])
    const db2 = freshDb()
    const s2 = seedEvent(db2)
    expect(enterResult(db2, s2.matchIds[0], { pointsA: 1, pointsB: 0, winnerAthleteId: s2.a1, winType: 'points' }).status).toBe('done')
  })

  it('rejects a winner who is not in the match', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    expect(() => enterResult(db, s.matchIds[0], { pointsA: 0, pointsB: 0, winnerAthleteId: s.a2, winType: 'points' })).toThrow(/not in match/)
  })
})

describe('createEntry', () => {
  it('reuses a pending match for the same pair', () => {
    const db = freshDb()
    const s = seedEvent(db)
    const m = createEntry(db, s.eventId, { athleteAId: s.b1, athleteBId: s.a1, pointsA: 3, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' })
    expect(m.id).toBe(s.matchIds[0])
    expect(m.pointsA).toBe(3)
    expect(db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(2)
  })

  it('creates an unassigned match at the end of the order otherwise', () => {
    const db = freshDb()
    const s = seedEvent(db)
    const m = createEntry(db, s.eventId, { athleteAId: s.a1, athleteBId: s.b2, pointsA: 0, pointsB: 4, winnerAthleteId: s.b2, winType: 'submission' })
    expect(m).toMatchObject({ athleteAId: s.a1, athleteBId: s.b2, matId: null, orderIndex: 2, status: 'done', winType: 'submission' })
  })
})

describe('entry routes', () => {
  it('creates an entry, corrects it, and validates pairs', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/entries`, { athleteAId: s.a1, athleteBId: s.b1, pointsA: 4, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' }, adminToken)
    expect(r.status).toBe(201)
    expect(r.body.match).toMatchObject({ status: 'done', a: { score: 4 }, b: { score: 2 } })
    const board = await call(app, 'GET', `/api/events/${s.eventId}/board`)
    expect(board.body.teams.map((t: any) => [t.wins, t.points])).toEqual([[1, 4], [0, 2]])
    const fix = await call(app, 'POST', `/api/matches/${r.body.match.id}/entry`, { pointsA: 4, pointsB: 4, winnerAthleteId: s.b1, winType: 'decision' }, adminToken)
    expect(fix.body.match.result).toEqual({ winnerAthleteId: s.b1, winType: 'decision' })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/entries`, { athleteAId: s.a1, athleteBId: s.a2, pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/entries`, { athleteAId: s.a1, athleteBId: s.b1, pointsA: 0, pointsB: 0, winnerAthleteId: s.b2, winType: 'points' }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/matches/999/entry`, { pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(404)
  })
})
