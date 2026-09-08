import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import { createTestApp, call } from './helpers.js'
import { enterResult, createEntry } from '../src/match/entry.js'
import { loadMatch, loadEvents, appendMatchEvent } from '../src/match/events.js'
import { mats, matches } from '../src/db/schema.js'
import { buildSnapshot } from '../src/live/snapshot.js'

describe('enterResult', () => {
  it('fills a pending match, marks it done, and advances the mat', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    const r = await enterResult(db, first, { entryId: 'entry-0001', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' })
    expect(r.duplicate).toBe(false)
    expect(r.match).toMatchObject({ status: 'done', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points', lastSeq: 3 })
    expect((await loadEvents(db, first)).map(e => e.type)).toEqual(['set_score', 'set_score', 'end'])
    expect((await loadEvents(db, first)).map(e => e.id)).toEqual(['entry:entry-0001', 'entry:entry-0001:2', 'entry:entry-0001:3'])
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(second)
    expect((await loadMatch(db, second)).status).toBe('live')
  })

  it('takes a correction on a done match through edit_result', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' })
    const r = await enterResult(db, s.matchIds[0], { entryId: 'entry-0002', pointsA: 2, pointsB: 2, winnerAthleteId: s.b1, winType: 'decision' })
    expect(r.match).toMatchObject({ status: 'done', pointsA: 2, pointsB: 2, winnerAthleteId: s.b1, winType: 'decision', lastSeq: 6 })
    expect((await loadEvents(db, s.matchIds[0])).at(-1)?.type).toBe('admin')
  })

  it('replays the same entryId without writing again', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    const input = { entryId: 'entry-0001', pointsA: 6, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' as const }
    const first = await enterResult(db, s.matchIds[0], input)
    const replay = await enterResult(db, s.matchIds[0], input)
    expect(replay.duplicate).toBe(true)
    expect(replay.match.lastSeq).toBe(first.match.lastSeq)
    expect(await loadEvents(db, s.matchIds[0])).toHaveLength(3)
  })

  it('pauses a running clock first and works on a setup event', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await appendMatchEvent(db, { id: 'c1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0 })
    const r = await enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 0, pointsB: 0, winnerAthleteId: s.b1, winType: 'submission' })
    expect(r.match.clockStartedAt).toBeNull()
    expect((await loadEvents(db, s.matchIds[0])).map(e => e.type)).toEqual(['clock_start', 'clock_pause', 'set_score', 'set_score', 'end'])
    expect((await loadEvents(db, s.matchIds[0]))[1].id).toBe('entry:entry-0001')
    const db2 = await freshDb()
    const s2 = await seedEvent(db2)
    expect((await enterResult(db2, s2.matchIds[0], { entryId: 'entry-0002', pointsA: 1, pointsB: 0, winnerAthleteId: s2.a1, winType: 'points' })).match.status).toBe('done')
  })

  it('rejects a winner who is not in the match', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await expect(enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 0, pointsB: 0, winnerAthleteId: s.a2, winType: 'points' })).rejects.toThrow(/not in match/)
  })
})

describe('createEntry', () => {
  it('reuses a pending match for the same pair', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const r = await createEntry(db, s.eventId, { entryId: 'entry-0001', athleteAId: s.b1, athleteBId: s.a1, pointsA: 3, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' })
    expect(r.match.id).toBe(s.matchIds[0])
    expect(r.match.pointsA).toBe(3)
    expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(2)
  })

  it('lands on the match a mat is showing, ends it, and advances that mat', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    const r = await createEntry(db, s.eventId, { entryId: 'entry-0001', athleteAId: s.b1, athleteBId: s.a1, pointsA: 5, pointsB: 1, winnerAthleteId: s.a1, winType: 'points' })
    expect(r.match.id).toBe(first)
    expect(r.match.status).toBe('done')
    expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(2)
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(second)
    const snap = await buildSnapshot(db, s.eventId, { nowMs: Date.now() })
    expect(snap.teams.map(t => t.wins)).toEqual([1, 0])
  })

  it('prefers a live match over a later pending one for the same pair', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true, matches: 1 })
    const extra = await db.insert(matches).values({
      eventId: s.eventId, matId: null, orderIndex: 5, rulesetId: s.rulesetId,
      lengthSec: 300, athleteAId: s.a1, athleteBId: s.b1,
    }).returning().get()
    const r = await createEntry(db, s.eventId, { entryId: 'entry-0002', athleteAId: s.a1, athleteBId: s.b1, pointsA: 2, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' })
    expect(r.match.id).toBe(s.matchIds[0])
    expect((await loadMatch(db, extra.id)).status).toBe('pending')
  })

  it('creates an unassigned match at the end of the order otherwise', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const r = await createEntry(db, s.eventId, { entryId: 'entry-0001', athleteAId: s.a1, athleteBId: s.b2, pointsA: 0, pointsB: 4, winnerAthleteId: s.b2, winType: 'submission' })
    expect(r.match).toMatchObject({ athleteAId: s.a1, athleteBId: s.b2, matId: null, orderIndex: 2, status: 'done', winType: 'submission' })
  })

  it('replays the same entryId without creating a second match', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matches: 0 })
    const input = { entryId: 'entry-0001', athleteAId: s.a1, athleteBId: s.b1, pointsA: 2, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' as const }
    const first = await createEntry(db, s.eventId, input)
    const replay = await createEntry(db, s.eventId, input)
    expect(replay.duplicate).toBe(true)
    expect(replay.match.id).toBe(first.match.id)
    expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(1)
  })
})

describe('entry routes', () => {
  it('creates an entry, corrects it, and validates pairs', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0001', athleteAId: s.a1, athleteBId: s.b1, pointsA: 4, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' }, adminToken)
    expect(r.status).toBe(201)
    expect(r.body.match).toMatchObject({ status: 'done', a: { score: 4 }, b: { score: 2 } })
    const board = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(board.body.snapshot.teams.map((t: any) => [t.wins, t.points])).toEqual([[1, 4], [0, 2]])
    const fix = await call(app, 'POST', `/api/matches/${r.body.match.id}/entry`, { entryId: 'entry-0002', pointsA: 4, pointsB: 4, winnerAthleteId: s.b1, winType: 'decision' }, adminToken)
    expect(fix.body.match.result).toEqual({ winnerAthleteId: s.b1, winType: 'decision' })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0003', athleteAId: s.a1, athleteBId: s.a2, pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0004', athleteAId: s.a1, athleteBId: s.b1, pointsA: 0, pointsB: 0, winnerAthleteId: s.b2, winType: 'points' }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/matches/999/entry`, { entryId: 'entry-0005', pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(404)
    expect((await call(app, 'POST', `/api/matches/${r.body.match.id}/entry`, { entryId: 'short', pointsA: 0, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' }, adminToken)).status).toBe(422)
  })

  // Finish closes the afternoon to new results, not to fixing the ones it produced. The
  // lock that stops a correction too is certification.
  it('refuses a new entry once the event is done, and still takes a correction', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const first = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, { entryId: 'entry-0001', pointsA: 3, pointsB: 1, winnerAthleteId: s.a1, winType: 'points' }, adminToken)
    expect(first.status).toBe(200)
    expect((await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'done' }, adminToken)).status).toBe(200)

    const late = await call(app, 'POST', `/api/events/${s.eventId}/entries`, { entryId: 'entry-0002', athleteAId: s.a2, athleteBId: s.b2, pointsA: 2, pointsB: 0, winnerAthleteId: s.a2, winType: 'points' }, adminToken)
    expect(late.status).toBe(409)
    expect(late.body.error).toMatchObject({ code: 'match_state', message: 'event is done' })

    const correction = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, { entryId: 'entry-0003', pointsA: 0, pointsB: 5, winnerAthleteId: s.b1, winType: 'points', reason: 'the mat called the wrong colour' }, adminToken)
    expect(correction.status).toBe(200)
    expect(correction.body.match.result).toEqual({ winnerAthleteId: s.b1, winType: 'points' })

    // The second designed match never settled, so typing it now is a new result.
    const unsettled = await call(app, 'POST', `/api/matches/${s.matchIds[1]}/entry`, { entryId: 'entry-0004', pointsA: 1, pointsB: 0, winnerAthleteId: s.a2, winType: 'points' }, adminToken)
    expect(unsettled.status).toBe(409)
    expect(unsettled.body.error).toMatchObject({ code: 'match_state', message: 'event is done' })

    const replay = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, { entryId: 'entry-0001', pointsA: 3, pointsB: 1, winnerAthleteId: s.a1, winType: 'points' }, adminToken)
    expect(replay.status).toBe(200)
    expect(replay.body.match.lastSeq).toBe(correction.body.match.lastSeq)
  })

  it('replays a create entry as a 200 without a second match', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const body = { entryId: 'entry-replay-01', athleteAId: s.a1, athleteBId: s.b1, pointsA: 4, pointsB: 2, winnerAthleteId: s.a1, winType: 'points' }
    const first = await call(app, 'POST', `/api/events/${s.eventId}/entries`, body, adminToken)
    expect(first.status).toBe(201)
    const replay = await call(app, 'POST', `/api/events/${s.eventId}/entries`, body, adminToken)
    expect(replay.status).toBe(200)
    expect(replay.body.match.id).toBe(first.body.match.id)
    expect(replay.body.version).toBe(first.body.version)
    expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toHaveLength(1)
    const board = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(board.body.snapshot.teams.map((t: any) => [t.wins, t.points])).toEqual([[1, 4], [0, 2]])
  })

  it('replays a match entry as a no-op', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const body = { entryId: 'entry-replay-02', pointsA: 3, pointsB: 1, winnerAthleteId: s.a1, winType: 'points' }
    const first = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, body, adminToken)
    expect(first.status).toBe(200)
    const replay = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/entry`, body, adminToken)
    expect(replay.status).toBe(200)
    expect(replay.body.match.id).toBe(first.body.match.id)
    expect(replay.body.match.lastSeq).toBe(first.body.match.lastSeq)
    expect(replay.body.match.result).toEqual(first.body.match.result)
    expect(replay.body.version).toBe(first.body.version)
    expect(await loadEvents(db, s.matchIds[0])).toHaveLength(3)
  })
})
