import { describe, it, expect } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  applyClockPause, applyClockStart, applyScore, applyUndo, errorCopy, signed, withDeadline,
  TimeoutError, type ClockAction, type ScoreAction,
} from '@/routes/scorer/actions'
import { clockRefusal, minusRefusal, REASONS, scoreRefusal, undoRefusal } from '@/routes/scorer/refusals'
import { fitsScorer } from '@/routes/scorer/viewport'
import {
  ALERT, COMMIT, LINE, MOAT, PAD, REASON, SECONDARY, SHORTEST_VIEWPORT, STALE_LINE, columnBudget,
} from '@/routes/scorer/budget'
import { sampleMatch } from './fakes'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

function action(over: Partial<ScoreAction> = {}): ScoreAction {
  return { kind: 'score', seq: 1, athleteId: 100, name: 'Mateo Rivera', label: 'Takedown', points: 2, at: '2:14', ...over }
}

function clockAction(over: Partial<ClockAction> = {}): ClockAction {
  return { kind: 'clock', seq: 1, label: 'Clock paused', at: '2:14', ...over }
}

describe('optimistic folds', () => {
  it('adds the points to the tapped side and steps the seq', () => {
    const next = applyScore(sampleMatch(), 200, 3)
    expect(next.b.score).toBe(3)
    expect(next.a.score).toBe(0)
    expect(next.lastSeq).toBe(1)
  })

  it('starts and pauses the clock locally, banking the time that ran', () => {
    const started = applyClockStart(sampleMatch(), new Date(T0).toISOString())
    expect(started.clock.startedAt).toBe('2026-10-03T16:00:00.000Z')
    const paused = applyClockPause(started, T0 + 12_000)
    expect(paused.clock.startedAt).toBeNull()
    expect(paused.clock.elapsedMs).toBe(12_000)
  })

  it('never banks more clock than the match is long', () => {
    const started = applyClockStart(sampleMatch(), new Date(T0).toISOString())
    expect(applyClockPause(started, T0 + 9_000_000).clock.elapsedMs).toBe(started.clock.lengthMs)
  })

  it('takes the points back off the side that scored them', () => {
    const scored = applyScore(sampleMatch(), 100, 2)
    const undone = applyUndo(scored, action({ seq: 1 }))
    expect(undone.a.score).toBe(0)
    expect(undone.lastSeq).toBe(0)
  })

  it('steps the seq back without touching a score when the newest event is not one of ours', () => {
    const scored = applyScore(sampleMatch(), 100, 2)
    const undone = applyUndo(scored, null)
    expect(undone.a.score).toBe(2)
    expect(undone.lastSeq).toBe(0)
  })

  it('signs a value the way the operator reads it', () => {
    expect(signed(2)).toBe('+2')
    expect(signed(-1)).toBe('-1')
  })
})

// A socket the room's access point dropped without a reset never settles, and the serial
// write chain behind it never drains. The deadline is what turns that into a rejection.
describe('the write deadline', () => {
  it('rejects a write that never answers, and passes one that does', async () => {
    await expect(withDeadline(new Promise(() => {}), 5)).rejects.toBeInstanceOf(TimeoutError)
    await expect(withDeadline(Promise.resolve('landed'), 50)).resolves.toBe('landed')
  })

  it('does not claim a timed out write failed to send, because it does not know', () => {
    expect(errorCopy(new TimeoutError())).toMatch(/Check the score/)
    expect(errorCopy(new TimeoutError())).not.toMatch(/did not send/)
  })
})

describe('errorCopy', () => {
  it('turns a sequence conflict into what is about to happen', () => {
    expect(errorCopy(new ApiError(409, 'sequence', 'stale sequence'))).toMatch(/Another device scored this mat first/)
  })

  it('says what to do about an ended match', () => {
    expect(errorCopy(new ApiError(409, 'match_state', 'match is done'))).toMatch(/Reopen it from the Live tab/)
  })

  it('keeps the server sentence when it is already an instruction', () => {
    expect(errorCopy(new ApiError(409, 'match_state', 'press Start to resume the clock'))).toBe('press Start to resume the clock')
  })

  it('names the connection when the failure never reached the server', () => {
    expect(errorCopy(new TypeError('network'))).toMatch(/Could not reach the server/)
  })
})

describe('refusals', () => {
  const live = sampleMatch()

  it('keeps score taps available while the clock is paused, because referees stop it to award points', () => {
    expect(scoreRefusal(true, { ...live, clock: { ...live.clock, startedAt: null } })).toBeNull()
  })

  it('refuses a whole half while a terminal is waiting', () => {
    expect(scoreRefusal(true, { ...live, pendingTerminal: { athleteId: 200, actionKey: 'pin' } })).toMatch(/result is waiting/)
  })

  it('refuses everything with the connection as the reason', () => {
    expect(scoreRefusal(false, live)).toMatch(/Not connected/)
    expect(clockRefusal(false, live, false)).toMatch(/Not connected/)
    expect(undoRefusal(false, live, null, false)).toMatch(/Not connected/)
  })

  it('refuses the clock once time is up, because the server will not restart it', () => {
    expect(clockRefusal(true, live, true)).toMatch(/Time is up/)
    expect(clockRefusal(true, live, false)).toBeNull()
  })

  it('refuses undo with nothing behind it', () => {
    expect(undoRefusal(true, live, null, false)).toMatch(/Nothing to take back/)
  })

  it('refuses undo of the clock running out', () => {
    const expired = { ...live, lastSeq: 4 }
    expect(undoRefusal(true, expired, null, true)).toMatch(/does not reach the clock/)
    expect(undoRefusal(true, expired, action({ seq: 4 }), true)).toBeNull()
  })

  // The server removes the newest event and nothing else: it turns down an undo of a pause,
  // and an undo of a start stops a clock nobody asked it to stop. A generic "Undo the last
  // action" after a clock press is therefore a control that cannot say what it does.
  it('refuses undo and the minus when the newest action was this tablet own clock press', () => {
    const afterClock = { ...live, lastSeq: 1 }
    expect(undoRefusal(true, afterClock, clockAction({ seq: 1 }), false)).toMatch(/does not reach the clock/)
    expect(minusRefusal(true, afterClock, clockAction({ seq: 1 }), 100)).toMatch(/does not reach the clock/)
    expect(minusRefusal(true, afterClock, clockAction({ seq: 1 }), 200)).toMatch(/does not reach the clock/)
  })

  it('refuses undo when the newest action came from another device', () => {
    const ahead = { ...live, lastSeq: 5 }
    expect(undoRefusal(true, ahead, action({ seq: 1 }), false)).toMatch(/came from elsewhere/)
    expect(undoRefusal(true, ahead, null, false)).toMatch(/came from elsewhere/)
  })

  it('offers the minus only to the side that owns the newest action', () => {
    const scored = { ...live, lastSeq: 1 }
    expect(minusRefusal(true, scored, action({ seq: 1 }), 100)).toBeNull()
    expect(minusRefusal(true, scored, action({ seq: 1 }), 200)).toBe("The newest action was Mateo Rivera's.")
  })

  it('refuses the minus when this tablet did not record the newest action', () => {
    const scored = { ...live, lastSeq: 5 }
    expect(minusRefusal(true, scored, action({ seq: 1 }), 100)).toMatch(/came from elsewhere/)
    expect(minusRefusal(true, scored, null, 100)).toMatch(/came from elsewhere/)
  })

  // The centre column reserves ONE t2 line for a reason (budget.REASON). A longer sentence
  // wraps, and the second line paints over the 104px control directly underneath it. The
  // content box is 320 minus the border pair minus the padding pair, and 13px Geist averages
  // a little over 6px a character, so 40 is the limit a reason may not cross.
  it('keeps every printed reason inside the one line the column reserves for it', () => {
    for (const reason of REASONS) expect(reason.length, reason).toBeLessThanOrEqual(40)
  })
})

/**
 * 6.16 sizes the commit controls in millimetres and the route accepts a 1024 x 768 iPad,
 * which is the shortest viewport it is designed against. jsdom computes no layout, so this
 * is where a stack that does not fit gets caught: the column and the test read the same
 * declared boxes out of budget.ts.
 */
describe('the centre column budget', () => {
  it('fits the shortest tablet with room for the alarm that the End match button answers', () => {
    const b = columnBudget(SHORTEST_VIEWPORT)
    expect(b.slack).toBeGreaterThanOrEqual(ALERT + LINE)
    // Late polls print "Not updating Ns" under the clock, which comes out of the same slack.
    expect(b.slack - STALE_LINE).toBeGreaterThanOrEqual(ALERT)
  })

  it('only ever has more room on a taller tablet', () => {
    let previous = columnBudget(SHORTEST_VIEWPORT).slack
    for (let h = SHORTEST_VIEWPORT; h <= 1400; h += 8) {
      const b = columnBudget(h)
      expect(b.slack, `${h}px`).toBeGreaterThanOrEqual(ALERT + LINE)
      expect(b.slack).toBeGreaterThanOrEqual(previous)
      previous = b.slack
    }
  })

  it('keeps every box on the 4px grid and at or above the size 6.16 gives it', () => {
    expect(COMMIT).toBeGreaterThanOrEqual(104)
    expect(SECONDARY).toBeGreaterThanOrEqual(64)
    expect(MOAT).toBe(32)
    for (const box of [PAD, COMMIT, SECONDARY, REASON, MOAT, ALERT]) expect(box % 4).toBe(0)
  })
})

describe('fitsScorer', () => {
  it('takes a landscape tablet and refuses everything narrower or taller than it is wide', () => {
    expect(fitsScorer(1194, 834)).toBe(true)
    expect(fitsScorer(900, 600)).toBe(true)
    expect(fitsScorer(899, 600)).toBe(false)
    expect(fitsScorer(1024, 1366)).toBe(false)
  })
})
