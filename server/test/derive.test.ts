import { describe, it, expect } from 'vitest'
import { deriveMatch, deriveOutcome, type MatchEventInput } from '../src/match/derive.js'
import { DEFAULT_TERMINALS } from '../src/shared/types.js'

const A = 11, B = 22, LEN = 300_000
const t = (s: number) => new Date(Date.parse('2026-08-27T18:00:00.000Z') + s * 1000).toISOString()
let seq = 0
const ev = (p: Partial<MatchEventInput> & { type: MatchEventInput['type'] }): MatchEventInput => ({
  seq: ++seq, athleteId: null, actionKey: null, points: null, payload: null, at: t(0), ...p,
})

describe('deriveMatch', () => {
  it('sums points per athlete and clamps at zero', () => {
    seq = 0
    const d = deriveMatch([
      ev({ type: 'score', athleteId: A, actionKey: 'takedown', points: 2 }),
      ev({ type: 'score', athleteId: B, actionKey: 'penalty', points: -1 }),
      ev({ type: 'score', athleteId: A, actionKey: 'mount', points: 4 }),
    ], A, B, LEN)
    expect(d.scoreA).toBe(6)
    expect(d.scoreB).toBe(0)
    expect(d.lastSeq).toBe(3)
  })

  it('set_score replaces the running total', () => {
    seq = 0
    const d = deriveMatch([
      ev({ type: 'score', athleteId: A, actionKey: 'takedown', points: 2 }),
      ev({ type: 'set_score', athleteId: A, points: 7 }),
      ev({ type: 'set_score', athleteId: B, points: 3 }),
      ev({ type: 'score', athleteId: B, actionKey: 'sweep', points: 2 }),
    ], A, B, LEN)
    expect(d.scoreA).toBe(7)
    expect(d.scoreB).toBe(5)
  })

  it('accumulates elapsed across start and pause', () => {
    seq = 0
    const d = deriveMatch([
      ev({ type: 'clock_start', at: t(0) }),
      ev({ type: 'clock_pause', at: t(30) }),
      ev({ type: 'clock_start', at: t(60) }),
    ], A, B, LEN)
    expect(d.clockElapsedMs).toBe(30_000)
    expect(d.clockStartedAt).toBe(t(60))
  })

  it('ignores a second start while running and any start after time is up', () => {
    seq = 0
    const d = deriveMatch([
      ev({ type: 'clock_start', at: t(0) }),
      ev({ type: 'clock_start', at: t(10) }),
      ev({ type: 'clock_pause', at: t(400) }),
      ev({ type: 'clock_start', at: t(500) }),
    ], A, B, LEN)
    expect(d.clockElapsedMs).toBe(LEN)
    expect(d.clockStartedAt).toBeNull()
  })

  it('records a pending terminal without touching the clock', () => {
    seq = 0
    const d = deriveMatch([
      ev({ type: 'clock_start', at: t(0) }),
      ev({ type: 'terminal', athleteId: A, actionKey: 'submission', at: t(20) }),
    ], A, B, LEN)
    expect(d.pendingTerminal).toEqual({ athleteId: A, actionKey: 'submission' })
    expect(d.clockStartedAt).toBe(t(0))
  })

  it('sets the result on end and clears it on reopen', () => {
    seq = 0
    const base = [ev({ type: 'end', athleteId: A, payload: { kind: 'end', winnerAthleteId: A, winType: 'points' } })]
    expect(deriveMatch(base, A, B, LEN).result).toEqual({ winnerAthleteId: A, winType: 'points' })
    const reopened = [...base, ev({ type: 'admin', payload: { kind: 'reopen' } })]
    expect(deriveMatch(reopened, A, B, LEN).result).toBeNull()
    const edited = [...reopened, ev({ type: 'admin', payload: { kind: 'edit_result', winnerAthleteId: B, winType: 'decision' } })]
    expect(deriveMatch(edited, A, B, LEN).result).toEqual({ winnerAthleteId: B, winType: 'decision' })
  })

  it('sorts by seq regardless of input order', () => {
    const d = deriveMatch([
      { seq: 2, type: 'clock_pause', athleteId: null, actionKey: null, points: null, payload: null, at: t(30) },
      { seq: 1, type: 'clock_start', athleteId: null, actionKey: null, points: null, payload: null, at: t(0) },
    ], A, B, LEN)
    expect(d.clockElapsedMs).toBe(30_000)
  })
})

describe('deriveOutcome', () => {
  const base = { scoreA: 0, scoreB: 0, clockElapsedMs: 0, clockStartedAt: null, lastSeq: 0, pendingTerminal: null, result: null }
  it('prefers the pending terminal', () => {
    const o = deriveOutcome({ ...base, scoreA: 0, scoreB: 9, pendingTerminal: { athleteId: A, actionKey: 'pin' } }, A, B, DEFAULT_TERMINALS)
    expect(o).toEqual({ kind: 'decided', winnerAthleteId: A, winType: 'submission' })
  })
  it('picks the higher score as a points win', () => {
    expect(deriveOutcome({ ...base, scoreA: 2, scoreB: 4 }, A, B, DEFAULT_TERMINALS)).toEqual({ kind: 'decided', winnerAthleteId: B, winType: 'points' })
  })
  it('reports a tie', () => {
    expect(deriveOutcome({ ...base, scoreA: 3, scoreB: 3 }, A, B, DEFAULT_TERMINALS)).toEqual({ kind: 'tie' })
  })
})
