import { describe, it, expect } from 'vitest'
import { freshDb, seedEvent } from './fixtures.js'
import { buildSnapshot } from '../src/live/snapshot.js'
import { appendMatchEvent, endMatch } from '../src/match/events.js'
import { advanceMat } from '../src/match/mats.js'

const opts = { version: 3, nowMs: Date.parse('2026-08-27T18:00:00.000Z'), isBound: (id: number) => id === 1 }

describe('buildSnapshot', () => {
  it('shapes event, teams, rulesets, mats, and matches', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    const snap = buildSnapshot(db, s.eventId, opts)
    expect(snap.version).toBe(3)
    expect(snap.now).toBe('2026-08-27T18:00:00.000Z')
    expect(snap.event).toEqual({ id: s.eventId, name: 'Fall Duels', date: '2026-10-03', status: 'live', matCount: 2 })
    expect(snap.teams.map(t => [t.name, t.wins, t.points])).toEqual([['Boulder', 0, 0], ['Denver', 0, 0]])
    expect(snap.rulesets[0].actions.find(a => a.key === 'mount')?.points).toBe(4)
    expect(snap.mats.map(m => [m.number, m.current?.id ?? null, m.bound])).toEqual([[1, s.matchIds[0], true], [2, s.matchIds[1], false]])
    expect(snap.matches[0].a).toMatchObject({ athleteId: s.a1, name: 'Mateo Rivera', teamId: s.teamA, belt: 'grey', weightLbs: 62, score: 0 })
    expect(snap.matches[0].clock).toEqual({ elapsedMs: 0, startedAt: null, lengthMs: 300_000 })
    expect(snap.matches[0].pendingTerminal).toBeNull()
  })

  it('tallies live points and done wins per team', () => {
    const db = freshDb()
    const s = seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    appendMatchEvent(db, { id: 'e1', matchId: first, type: 'score', athleteId: s.a1, actionKey: 'mount', lastSeq: 0 })
    appendMatchEvent(db, { id: 'e2', matchId: first, type: 'score', athleteId: s.b1, actionKey: 'takedown', lastSeq: 1 })
    let snap = buildSnapshot(db, s.eventId, opts)
    expect(snap.teams.map(t => [t.wins, t.points])).toEqual([[0, 4], [0, 2]])
    endMatch(db, { id: 'end1', matchId: first, lastSeq: 2 })
    advanceMat(db, s.matIds[0])
    appendMatchEvent(db, { id: 'e3', matchId: second, type: 'score', athleteId: s.b2, actionKey: 'pass', lastSeq: 0 })
    snap = buildSnapshot(db, s.eventId, opts)
    expect(snap.teams.map(t => [t.wins, t.points])).toEqual([[1, 4], [0, 5]])
    expect(snap.matches[0].result).toEqual({ winnerAthleteId: s.a1, winType: 'points' })
  })

  it('lists on-deck matches per mat without the current one', () => {
    const db = freshDb()
    const s = seedEvent(db, { matCount: 1, live: true })
    const snap = buildSnapshot(db, s.eventId, opts)
    expect(snap.mats[0].current?.id).toBe(s.matchIds[0])
    expect(snap.mats[0].onDeck.map(m => m.id)).toEqual([s.matchIds[1]])
  })

  it('exposes a pending terminal', () => {
    const db = freshDb()
    const s = seedEvent(db, { live: true })
    appendMatchEvent(db, { id: 't1', matchId: s.matchIds[0], type: 'terminal', athleteId: s.b1, actionKey: 'pin', lastSeq: 0 })
    expect(buildSnapshot(db, s.eventId, opts).matches[0].pendingTerminal).toEqual({ athleteId: s.b1, actionKey: 'pin' })
  })

  it('throws on an unknown event', () => {
    expect(() => buildSnapshot(freshDb(), 999, opts)).toThrow(/not found/)
  })
})
