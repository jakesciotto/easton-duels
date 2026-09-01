import { describe, it, expect } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  applyClockPause, applyClockStart, applyScore, applyUndo, errorCopy, signed, withDeadline,
  TimeoutError, type ClockAction, type ScoreAction,
} from '@/routes/scorer/actions'
import { clockRefusal, minusRefusal, REASONS, scoreRefusal, undoRefusal } from '@/routes/scorer/refusals'
import { fitsScorer } from '@/routes/scorer/viewport'
import {
  ALERT, COMMIT, HEAD_LINE, IPAD_SCREEN_HEIGHT, LINE, MAX_BROWSER_CHROME, MINUS_ROW, MOAT, PAD,
  REASON, SECONDARY, SHORTEST_VIEWPORT, STACK, STACK_COMMIT, STALE_LINE, columnBudget,
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

  // Time being up does not tell this tablet what the newest event is. The server writes a
  // pause at expiry, but the desk can record an advantage after it, and the reason that
  // named the clock on that assumption was then simply wrong. The refusal now says only
  // what is true either way, and undo of this tablet's own post-expiry score still works.
  it('does not blame the clock for an event it cannot see, expired or not', () => {
    const expired = { ...live, lastSeq: 4 }
    expect(undoRefusal(true, expired, null, true)).toMatch(/came from elsewhere/)
    expect(undoRefusal(true, expired, null, true)).not.toMatch(/does not reach the clock/)
    expect(undoRefusal(true, expired, action({ seq: 1 }), true)).toMatch(/came from elsewhere/)
    expect(undoRefusal(true, expired, action({ seq: 4 }), true)).toBeNull()
    // The clock is only named when this tablet recorded the clock press itself.
    expect(undoRefusal(true, expired, clockAction({ seq: 4 }), true)).toMatch(/does not reach the clock/)
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
 * 6.16 sizes the commit controls in millimetres and the route accepts a 1024 x 768 iPad.
 * jsdom computes no layout, so this is where a stack that does not fit gets caught: the
 * column and the test read the same declared boxes out of budget.ts.
 *
 * What is proved here is the GUARANTEE, not a positive slack number. At the real worst
 * case there is no slack to speak of, so the question is which element gives: never the
 * expiry alarm, never End match.
 */
describe('the centre column budget', () => {
  // The number this was measured against for a whole revision was the iPad's SCREEN
  // height. The column lays out in the visual viewport, which is the screen minus the
  // browser's chrome, so 768 overstated the room by 50 to 90px and the alarm went into a
  // scroll box on real hardware while this file reported 75px of slack.
  it('is measured against the layout viewport, not the tablet screen', () => {
    expect(SHORTEST_VIEWPORT).toBe(IPAD_SCREEN_HEIGHT - MAX_BROWSER_CHROME)
    expect(SHORTEST_VIEWPORT).toBeLessThan(IPAD_SCREEN_HEIGHT - 50)
    expect(MAX_BROWSER_CHROME).toBeGreaterThanOrEqual(90)
  })

  // The whole point. The head, the expiry Alert and the three commit controls have to be on
  // screen at every height the route accepts, with the alarm SHOWING, which is the moment
  // the column is asked to hold the most. A step of 1 catches a threshold that only fails
  // between two multiples of 8.
  it('keeps the expiry alarm and End match on screen at every height from the shortest layout viewport up', () => {
    for (let h = SHORTEST_VIEWPORT; h <= 1400; h += 1) {
      const b = columnBudget(h)
      expect(b.guaranteed, `${h}px`).toBeLessThanOrEqual(h)
      expect(b.fixed, `${h}px`).toBeLessThanOrEqual(h)
      expect(b.slack, `${h}px`).toBeGreaterThanOrEqual(0)
    }
  })

  // "Not updating Ns" takes the head's identity slot rather than adding a row to it, so a
  // late poll cannot spend 18px of a guarantee that has 3 to give.
  it('does not let a late poll add a row to the head', () => {
    expect(HEAD_LINE).toBe(Math.max(16, STALE_LINE))
    expect(columnBudget(SHORTEST_VIEWPORT).guaranteed + STALE_LINE).toBeGreaterThan(SHORTEST_VIEWPORT)
  })

  // 6.16's floors are not negotiable, so the shortest tablet does not fit everything. What
  // yields is the secondary minus row -- never a commit control, never the alarm.
  it('buys the fit with the secondary row, never by shrinking a commit control', () => {
    const b = columnBudget(SHORTEST_VIEWPORT)
    expect(b.minusRowFixed).toBe(false)
    expect(b.fixed).toBe(b.guaranteed)
    // Proof that it genuinely does not fit, rather than that somebody trimmed a control.
    expect(b.guaranteed + MINUS_ROW).toBeGreaterThan(SHORTEST_VIEWPORT)
    expect(STACK - STACK_COMMIT).toBe(MINUS_ROW)
    expect(STACK_COMMIT).toBeGreaterThanOrEqual(3 * COMMIT)
  })

  // Once a tablet is tall enough for the minus row it never loses it again, so the stack's
  // shape is a fact about the device rather than something that moves mid match.
  it('returns the minus row to the stack as height allows, and never takes it back', () => {
    let seen = false
    for (let h = SHORTEST_VIEWPORT; h <= 1400; h += 1) {
      const on = columnBudget(h).minusRowFixed
      if (on) seen = true
      expect(on || !seen, `${h}px`).toBe(true)
    }
    expect(seen).toBe(true)
  })

  // What the alarm displaces is the reference content, which is the trade this whole
  // arrangement exists to make.
  it('has room for the last action line whenever the alarm is not showing', () => {
    const b = columnBudget(SHORTEST_VIEWPORT)
    expect(b.slack + ALERT).toBeGreaterThanOrEqual(LINE)
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
