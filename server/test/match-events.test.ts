import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import { appendMatchEvent, endMatch, undoLastMatchEvent, loadEvents, latestEndedAt, endedAtByMatch, bumpVersion, SeqConflict, MatchStateError, DecisionRequired } from '../src/match/events.js'
import { events } from '../src/db/schema.js'

const T = (s: number) => new Date(Date.parse('2026-08-27T18:00:00.000Z') + s * 1000).toISOString()

async function liveMatch() {
  const db = await freshDb()
  const s = await seedEvent(db, { live: true })
  return { db, s, matchId: s.matchIds[0] }
}

describe('appendMatchEvent', () => {
  it('scores from the ruleset and advances lastSeq', async () => {
    const { db, s, matchId } = await liveMatch()
    const r = await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    expect(r.duplicate).toBe(false)
    expect(r.match.pointsA).toBe(2)
    expect(r.match.pointsB).toBe(0)
    expect(r.match.lastSeq).toBe(1)
  })

  it('treats a duplicate id as success without writing', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    const r = await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    expect(r.duplicate).toBe(true)
    expect(r.match.pointsA).toBe(2)
    expect(await loadEvents(db, matchId)).toHaveLength(1)
  })

  it('rejects a stale lastSeq with the current seq', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    await expect(appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.a1, actionKey: 'sweep', lastSeq: 0 }))
      .rejects.toThrow(SeqConflict)
    try { await appendMatchEvent(db, { id: 'e3', matchId, type: 'score', athleteId: s.a1, actionKey: 'sweep', lastSeq: 0 }) } catch (e) {
      expect((e as SeqConflict).currentSeq).toBe(1)
    }
  })

  it('rejects unknown actions and outside athletes', async () => {
    const { db, s, matchId } = await liveMatch()
    await expect(appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'nope', lastSeq: 0 })).rejects.toThrow(MatchStateError)
    await expect(appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.a2, actionKey: 'takedown', lastSeq: 0 })).rejects.toThrow(MatchStateError)
  })

  it('refuses writes on a pending match', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true, matCount: 1 })
    await expect(appendMatchEvent(db, { id: 'e1', matchId: s.matchIds[1], type: 'clock_start', lastSeq: 0 })).rejects.toThrow(/pending/)
  })

  it('runs and pauses the clock', async () => {
    const { db, matchId } = await liveMatch()
    let r = await appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    expect(r.match.clockStartedAt).toBe(T(0))
    await expect(appendMatchEvent(db, { id: 'c2', matchId, type: 'clock_start', lastSeq: 1, at: T(1) })).rejects.toThrow(/running/)
    r = await appendMatchEvent(db, { id: 'c3', matchId, type: 'clock_pause', lastSeq: 1, at: T(45) })
    expect(r.match.clockStartedAt).toBeNull()
    expect(r.match.clockElapsedMs).toBe(45_000)
    await expect(appendMatchEvent(db, { id: 'c4', matchId, type: 'clock_pause', lastSeq: 2, at: T(46) })).rejects.toThrow(/not running/)
  })

  it('refuses to score while the event is in setup', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    await expect(appendMatchEvent(db, { id: 'e1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0 })).rejects.toThrow(/setup/)
  })

  it('pauses the clock before a terminal and blocks restart while pending', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    const r = await appendMatchEvent(db, { id: 't1', matchId, type: 'terminal', athleteId: s.b1, actionKey: 'pin', lastSeq: 1, at: T(20) })
    expect(r.match.lastSeq).toBe(3)
    expect(r.match.clockStartedAt).toBeNull()
    expect(r.match.clockElapsedMs).toBe(20_000)
    expect(r.match.pendingTerminalAthleteId).toBe(s.b1)
    expect(r.match.pendingTerminalKey).toBe('pin')
    expect((await loadEvents(db, matchId)).map(e => e.type)).toEqual(['clock_start', 'clock_pause', 'terminal'])
    await expect(appendMatchEvent(db, { id: 'c2', matchId, type: 'clock_start', lastSeq: 3 })).rejects.toThrow(/pending/)
  })
})

describe('endMatch', () => {
  it('derives a points win and marks done', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.b1, actionKey: 'mount', lastSeq: 0 })
    const r = await endMatch(db, { id: 'end1', matchId, lastSeq: 1 })
    expect(r.match.status).toBe('done')
    expect(r.match.winnerAthleteId).toBe(s.b1)
    expect(r.match.winType).toBe('points')
    await expect(appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.b1, actionKey: 'mount', lastSeq: 2 })).rejects.toThrow(/done/)
  })

  it('uses the pending terminal win type', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 't1', matchId, type: 'terminal', athleteId: s.a1, actionKey: 'submission', lastSeq: 0 })
    const r = await endMatch(db, { id: 'end1', matchId, lastSeq: 1 })
    expect(r.match.winnerAthleteId).toBe(s.a1)
    expect(r.match.winType).toBe('submission')
  })

  it('requires a decision on a tie and records it', async () => {
    const { db, s, matchId } = await liveMatch()
    await expect(endMatch(db, { id: 'end1', matchId, lastSeq: 0 })).rejects.toThrow(DecisionRequired)
    const r = await endMatch(db, { id: 'end2', matchId, lastSeq: 0, winnerAthleteId: s.a1 })
    expect(r.match.winType).toBe('decision')
    expect(r.match.winnerAthleteId).toBe(s.a1)
  })

  it('pauses a running clock before the end event', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'pass', lastSeq: 1, at: T(10) })
    const r = await endMatch(db, { id: 'end1', matchId, lastSeq: 2, at: T(90) })
    expect(r.match.clockStartedAt).toBeNull()
    expect(r.match.clockElapsedMs).toBe(90_000)
    expect((await loadEvents(db, matchId)).map(e => e.type)).toEqual(['clock_start', 'score', 'clock_pause', 'end'])
  })
})

describe('latestEndedAt and endedAtByMatch', () => {
  it('reads the latest end event and stays null before one exists', async () => {
    const { db, s, matchId } = await liveMatch()
    expect(await latestEndedAt(db, matchId)).toBeNull()
    await endMatch(db, { id: 'end1', matchId, lastSeq: 0, winnerAthleteId: s.a1, at: T(0) })
    expect(await latestEndedAt(db, matchId)).toBe(T(0))
  })

  it('batches the latest end time per match, leaving an unfinished match out', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await endMatch(db, { id: 'end1', matchId: first, lastSeq: 0, winnerAthleteId: s.a1, at: T(0) })
    const map = await endedAtByMatch(db, [first, second])
    expect(map.get(first)).toBe(T(0))
    expect(map.has(second)).toBe(false)
    expect(await endedAtByMatch(db, [])).toEqual(new Map())
  })
})

describe('bumpVersion', () => {
  it('increments the event version by one, starting from zero', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const read = () => db.select({ version: events.version }).from(events).where(eq(events.id, s.eventId)).get()
    expect((await read())?.version).toBe(0)
    await bumpVersion(db, s.eventId)
    expect((await read())?.version).toBe(1)
    await bumpVersion(db, s.eventId)
    expect((await read())?.version).toBe(2)
  })
})

describe('undoLastMatchEvent', () => {
  it('removes the last event and recomputes', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    await appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.a1, actionKey: 'mount', lastSeq: 1 })
    const m = await undoLastMatchEvent(db, { matchId, lastSeq: 2 })
    expect(m.pointsA).toBe(2)
    expect(m.lastSeq).toBe(1)
  })

  it('leaves the clock paused when undoing a terminal', async () => {
    const { db, s, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    await appendMatchEvent(db, { id: 't1', matchId, type: 'terminal', athleteId: s.a1, actionKey: 'pin', lastSeq: 1, at: T(20) })
    const m = await undoLastMatchEvent(db, { matchId, lastSeq: 3 })
    expect(m.pendingTerminalKey).toBeNull()
    expect(m.clockStartedAt).toBeNull()
    expect(m.clockElapsedMs).toBe(20_000)
  })

  it('refuses to undo a clock pause but still undoes a clock start', async () => {
    const { db, matchId } = await liveMatch()
    await appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    await appendMatchEvent(db, { id: 'c2', matchId, type: 'clock_pause', lastSeq: 1, at: T(30) })
    await expect(undoLastMatchEvent(db, { matchId, lastSeq: 2 })).rejects.toThrow(/press Start to resume the clock/)
    const other = await liveMatch()
    await appendMatchEvent(other.db, { id: 'c1', matchId: other.matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    const m = await undoLastMatchEvent(other.db, { matchId: other.matchId, lastSeq: 1 })
    expect(m.clockStartedAt).toBeNull()
    expect(m.lastSeq).toBe(0)
  })

  it('refuses on a done match, on a stale seq, and on an empty log', async () => {
    const { db, s, matchId } = await liveMatch()
    await expect(undoLastMatchEvent(db, { matchId, lastSeq: 0 })).rejects.toThrow(/nothing/)
    await appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    await expect(undoLastMatchEvent(db, { matchId, lastSeq: 0 })).rejects.toThrow(SeqConflict)
    await endMatch(db, { id: 'end1', matchId, lastSeq: 1 })
    await expect(undoLastMatchEvent(db, { matchId, lastSeq: 2 })).rejects.toThrow(/done/)
  })
})
