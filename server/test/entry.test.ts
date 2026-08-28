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
    const r = enterResult(db, first, { entryId: 'entry-0001', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' })
    expect(r.duplicate).toBe(false)
    expect(r.match).toMatchObject({ status: 'done', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points', lastSeq: 3 })
    expect(loadEvents(db, first).map(e => e.type)).toEqual(['set_score', 'set_score', 'end'])
    expect(loadEvents(db, first).map(e => e.id)).toEqual(['entry:entry-0001', 'entry:entry-0001:2', 'entry:entry-0001:3'])
    expect(db.select().from(mats).where(eq(mats.id, s.matIds[0])).get()?.currentMatchId).toBe(second)
    expect(loadMatch(db, second).status).toBe('live')
  })

  it('takes a correction on a done match through edit_result', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' })
    const r = enterResult(db, s.matchIds[0], { entryId: 'entry-0002', pointsA: 2, pointsB: 2, winnerAthleteId: s.b1, winType: 'decision' })
    expect(r.match).toMatchObject({ status: 'done', pointsA: 2, pointsB: 2, winnerAthleteId: s.b1, winType: 'decision', lastSeq: 6 })
    expect(loadEvents(db, s.matchIds[0]).at(-1)?.type).toBe('admin')
  })

  it('replays the same entryId without writing again', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    const input = { entryId: 'entry-0001', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' as const }
    const first = enterResult(db, s.matchIds[0], input)
    const replay = enterResult(db, s.matchIds[0], input)
    expect(replay.duplicate).toBe(true)
    expect(replay.match.lastSeq).toBe(first.match.lastSeq)
    expect(loadEvents(db, s.matchIds[0])).toHaveLength(3)
  })

  it('pauses a running clock first and works on a setup event', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    appendMatchEvent(db, { id: 'c1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0 })
    const r = enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 0, pointsB: 0, winnerAthleteId: s.b1, winType: 'submission' })
    expect(r.match.clockStartedAt).toBeNull()
    expect(loadEvents(db, s.matchIds[0]).map(e => e.type)).toEqual(['clock_start', 'clock_pause', 'set_score', 'set_score', 'end'])
    expect(loadEvents(db, s.matchIds[0])[1].id).toBe('entry:entry-0001')
    const db2 = freshDb()
    const s2 = seedEvent(db2)
    expect(enterResult(db2, s2.matchIds[0], { entryId: 'entry-0002', pointsA: 1, pointsB: 0, winnerAthleteId: s2.a1, winType: 'points' }).match.status).toBe('done')
  })

  it('rejects a winner who is not in the match', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    expect(() => enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 0, pointsB: 0, winnerAthleteId: s.a2, winType: 'points' })).toThrow(/not in match/)
  })
})

describe('createEntry', () => {
  it('reuses a pending match for the same pair', () => {
    const db = freshDb()
    const s = seedEvent(db)
    const r = createEntry(db, s.eventId, { entryId: 'entry-0001', athleteAId: s.b1, athleteBId: s.a1, pointsA: 3, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' })
    expect(r.match.id).toBe(s.matchIds[0])
    expect(r.match.pointsA).toBe(3)
    expect(db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(2)
  })

  it('creates an unassigned match at the end of the order otherwise', () => {
    const db = freshDb()
    const s = seedEvent(db)
    const r = createEntry(db, s.eventId, { entryId: 'entry-0001', athleteAId: s.a1, athleteBId: s.b2, pointsA: 0, pointsB: 4, winnerAthleteId: s.b2, winType: 'submission' })
    expect(r.match).toMatchObject({ athleteAId: s.a1, athleteBId: s.b2, matId: null, orderIndex: 2, status: 'done', winType: 'submission' })
  })

  it('replays the same entryId without creating a second match', () => {
    const db = freshDb()
    const s = seedEvent(db, { matches: 0 })
    const input = { entryId: 'entry-0001', athleteAId: s.a1, athleteBId: s.b1, pointsA: 2, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' as const }
    const first = createEntry(db, s.eventId, input)
    const replay = createEntry(db, s.eventId, input)
    expect(replay.duplicate).toBe(true)
    expect(replay.match.id).toBe(first.match.id)
    expect(db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(1)
  })
})

describe('entry routes', () => {
  it('creates an entry, corrects it, and validates pairs', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0001', athleteAId: s.a1, athleteBId: s.b1, pointsA: 4, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' }, adminToken)
    expect(r.status).toBe(201)
    expect(r.body.match).toMatchObject({ status: 'done', a: { score: 4 }, b: { score: 2 } })
    const board = await call(app, 'GET', `/api/events/${s.eventId}/board`)
    expect(board.body.teams.map((t: any) => [t.wins, t.points])).toEqual([[1, 4], [0, 2]])
    const fix = await call(app, 'POST', `/api/matches/${r.body.match.id}/entry`, { entryId: 'entry-0002', pointsA: 4, pointsB: 4, winnerAthleteId: s.b1, winType: 'decision' }, adminToken)
    expect(fix.body.match.result).toEqual({ winnerAthleteId: s.b1, winType: 'decision' })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0003', athleteAId: s.a1, athleteBId: s.a2, pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0004', athleteAId: s.a1, athleteBId: s.b1, pointsA: 0, pointsB: 0, winnerAthleteId: s.b2, winType: 'points' }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/matches/999/entry`, { entryId: 'entry-0005', pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(404)
    expect((await call(app, 'POST', `/api/matches/${r.body.match.id}/entry`, { entryId: 'short', pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(422)
  })

  it('replays a create entry as a 200 without a second match', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    const body = { entryId: 'entry-replay-01', athleteAId: s.a1, athleteBId: s.b1, pointsA: 4, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' }
    const first = await call(app, 'POST', `/api/events/${s.eventId}/entries`, body, adminToken)
    expect(first.status).toBe(201)
    const replay = await call(app, 'POST', `/api/events/${s.eventId}/entries`, body, adminToken)
    expect(replay.status).toBe(200)
    expect(replay.body.match.id).toBe(first.body.match.id)
    expect(replay.body.version).toBe(first.body.version)
    expect(db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(1)
    const board = await call(app, 'GET', `/api/events/${s.eventId}/board`)
    expect(board.body.teams.map((t: any) => [t.wins, t.points])).toEqual([[1, 4], [0, 2]])
  })

  it('replays a match entry as a no-op', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { live: true })
    const body = { entryId: 'entry-replay-02', pointsA: 3, pointsB: 1, winnerAthleteId: s.a1, winType: 'points' }
    const first = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, body, adminToken)
    expect(first.status).toBe(200)
    const replay = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, body, adminToken)
    expect(replay.status).toBe(200)
    expect(replay.body.match.id).toBe(first.body.match.id)
    expect(replay.body.match.lastSeq).toBe(first.body.match.lastSeq)
    expect(replay.body.match.result).toEqual(first.body.match.result)
    expect(replay.body.version).toBe(first.body.version)
    expect(loadEvents(db, s.matchIds[0])).toHaveLength(3)
  })
})
