import { describe, it, expect } from 'vitest'
import { freshDb, seedEvent } from './fixtures.js'
import { appendMatchEvent, endMatch, undoLastMatchEvent, loadEvents, latestEndedAt, endedAtByMatch, SeqConflict, MatchStateError, DecisionRequired } from '../src/match/events.js'

const T = (s: number) => new Date(Date.parse('2026-08-27T18:00:00.000Z') + s * 1000).toISOString()

function liveMatch() {
  const db = freshDb()
  const s = seedEvent(db, { live: true })
  return { db, s, matchId: s.matchIds[0] }
}

describe('appendMatchEvent', () => {
  it('scores from the ruleset and advances lastSeq', () => {
    const { db, s, matchId } = liveMatch()
    const r = appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    expect(r.duplicate).toBe(false)
    expect(r.match.pointsA).toBe(2)
    expect(r.match.pointsB).toBe(0)
    expect(r.match.lastSeq).toBe(1)
  })

  it('treats a duplicate id as success without writing', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    const r = appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    expect(r.duplicate).toBe(true)
    expect(r.match.pointsA).toBe(2)
    expect(loadEvents(db, matchId)).toHaveLength(1)
  })

  it('rejects a stale lastSeq with the current seq', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    expect(() => appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.a1, actionKey: 'sweep', lastSeq: 0 }))
      .toThrow(SeqConflict)
    try { appendMatchEvent(db, { id: 'e3', matchId, type: 'score', athleteId: s.a1, actionKey: 'sweep', lastSeq: 0 }) } catch (e) {
      expect((e as SeqConflict).currentSeq).toBe(1)
    }
  })

  it('rejects unknown actions and outside athletes', () => {
    const { db, s, matchId } = liveMatch()
    expect(() => appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'nope', lastSeq: 0 })).toThrow(MatchStateError)
    expect(() => appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.a2, actionKey: 'takedown', lastSeq: 0 })).toThrow(MatchStateError)
  })

  it('refuses writes on a pending match', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true, matCount: 1 })
    expect(() => appendMatchEvent(db, { id: 'e1', matchId: s.matchIds[1], type: 'clock_start', lastSeq: 0 })).toThrow(/pending/)
  })

  it('runs and pauses the clock', () => {
    const { db, matchId } = liveMatch()
    let r = appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    expect(r.match.clockStartedAt).toBe(T(0))
    expect(() => appendMatchEvent(db, { id: 'c2', matchId, type: 'clock_start', lastSeq: 1, at: T(1) })).toThrow(/running/)
    r = appendMatchEvent(db, { id: 'c3', matchId, type: 'clock_pause', lastSeq: 1, at: T(45) })
    expect(r.match.clockStartedAt).toBeNull()
    expect(r.match.clockElapsedMs).toBe(45_000)
    expect(() => appendMatchEvent(db, { id: 'c4', matchId, type: 'clock_pause', lastSeq: 2, at: T(46) })).toThrow(/not running/)
  })

  it('refuses to score while the event is in setup', () => {
    const db = freshDb()
    const s = seedEvent(db)
    expect(() => appendMatchEvent(db, { id: 'e1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0 })).toThrow(/setup/)
  })

  it('pauses the clock before a terminal and blocks restart while pending', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    const r = appendMatchEvent(db, { id: 't1', matchId, type: 'terminal', athleteId: s.b1, actionKey: 'pin', lastSeq: 1, at: T(20) })
    expect(r.match.lastSeq).toBe(3)
    expect(r.match.clockStartedAt).toBeNull()
    expect(r.match.clockElapsedMs).toBe(20_000)
    expect(r.match.pendingTerminalAthleteId).toBe(s.b1)
    expect(r.match.pendingTerminalKey).toBe('pin')
    expect(loadEvents(db, matchId).map(e => e.type)).toEqual(['clock_start', 'clock_pause', 'terminal'])
    expect(() => appendMatchEvent(db, { id: 'c2', matchId, type: 'clock_start', lastSeq: 3 })).toThrow(/pending/)
  })
})

describe('endMatch', () => {
  it('derives a points win and marks done', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.b1, actionKey: 'mount', lastSeq: 0 })
    const r = endMatch(db, { id: 'end1', matchId, lastSeq: 1 })
    expect(r.match.status).toBe('done')
    expect(r.match.winnerAthleteId).toBe(s.b1)
    expect(r.match.winType).toBe('points')
    expect(() => appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.b1, actionKey: 'mount', lastSeq: 2 })).toThrow(/done/)
  })

  it('uses the pending terminal win type', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 't1', matchId, type: 'terminal', athleteId: s.a1, actionKey: 'submission', lastSeq: 0 })
    const r = endMatch(db, { id: 'end1', matchId, lastSeq: 1 })
    expect(r.match.winnerAthleteId).toBe(s.a1)
    expect(r.match.winType).toBe('submission')
  })

  it('requires a decision on a tie and records it', () => {
    const { db, s, matchId } = liveMatch()
    expect(() => endMatch(db, { id: 'end1', matchId, lastSeq: 0 })).toThrow(DecisionRequired)
    const r = endMatch(db, { id: 'end2', matchId, lastSeq: 0, winnerAthleteId: s.a1 })
    expect(r.match.winType).toBe('decision')
    expect(r.match.winnerAthleteId).toBe(s.a1)
  })

  it('pauses a running clock before the end event', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'pass', lastSeq: 1, at: T(10) })
    const r = endMatch(db, { id: 'end1', matchId, lastSeq: 2, at: T(90) })
    expect(r.match.clockStartedAt).toBeNull()
    expect(r.match.clockElapsedMs).toBe(90_000)
    expect(loadEvents(db, matchId).map(e => e.type)).toEqual(['clock_start', 'score', 'clock_pause', 'end'])
  })
})

describe('latestEndedAt and endedAtByMatch', () => {
  it('reads the latest end event and stays null before one exists', () => {
    const { db, s, matchId } = liveMatch()
    expect(latestEndedAt(db, matchId)).toBeNull()
    endMatch(db, { id: 'end1', matchId, lastSeq: 0, winnerAthleteId: s.a1, at: T(0) })
    expect(latestEndedAt(db, matchId)).toBe(T(0))
  })

  it('batches the latest end time per match, leaving an unfinished match out', () => {
    const db = freshDb()
    const s = seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    endMatch(db, { id: 'end1', matchId: first, lastSeq: 0, winnerAthleteId: s.a1, at: T(0) })
    const map = endedAtByMatch(db, [first, second])
    expect(map.get(first)).toBe(T(0))
    expect(map.has(second)).toBe(false)
    expect(endedAtByMatch(db, [])).toEqual(new Map())
  })
})

describe('undoLastMatchEvent', () => {
  it('removes the last event and recomputes', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    appendMatchEvent(db, { id: 'e2', matchId, type: 'score', athleteId: s.a1, actionKey: 'mount', lastSeq: 1 })
    const m = undoLastMatchEvent(db, { matchId, lastSeq: 2 })
    expect(m.pointsA).toBe(2)
    expect(m.lastSeq).toBe(1)
  })

  it('leaves the clock paused when undoing a terminal', () => {
    const { db, s, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    appendMatchEvent(db, { id: 't1', matchId, type: 'terminal', athleteId: s.a1, actionKey: 'pin', lastSeq: 1, at: T(20) })
    const m = undoLastMatchEvent(db, { matchId, lastSeq: 3 })
    expect(m.pendingTerminalKey).toBeNull()
    expect(m.clockStartedAt).toBeNull()
    expect(m.clockElapsedMs).toBe(20_000)
  })

  it('refuses to undo a clock pause but still undoes a clock start', () => {
    const { db, matchId } = liveMatch()
    appendMatchEvent(db, { id: 'c1', matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    appendMatchEvent(db, { id: 'c2', matchId, type: 'clock_pause', lastSeq: 1, at: T(30) })
    expect(() => undoLastMatchEvent(db, { matchId, lastSeq: 2 })).toThrow(/press Start to resume the clock/)
    const other = liveMatch()
    appendMatchEvent(other.db, { id: 'c1', matchId: other.matchId, type: 'clock_start', lastSeq: 0, at: T(0) })
    const m = undoLastMatchEvent(other.db, { matchId: other.matchId, lastSeq: 1 })
    expect(m.clockStartedAt).toBeNull()
    expect(m.lastSeq).toBe(0)
  })

  it('refuses on a done match, on a stale seq, and on an empty log', () => {
    const { db, s, matchId } = liveMatch()
    expect(() => undoLastMatchEvent(db, { matchId, lastSeq: 0 })).toThrow(/nothing/)
    appendMatchEvent(db, { id: 'e1', matchId, type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    expect(() => undoLastMatchEvent(db, { matchId, lastSeq: 0 })).toThrow(SeqConflict)
    endMatch(db, { id: 'end1', matchId, lastSeq: 1 })
    expect(() => undoLastMatchEvent(db, { matchId, lastSeq: 2 })).toThrow(/done/)
  })
})
