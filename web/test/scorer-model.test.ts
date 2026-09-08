import { describe, it, expect, beforeEach } from 'vitest'
import { ApiError } from '@/lib/api'
import { CERTIFIED_REFUSAL } from '@/lib/eventMode'
import { EXTEND_MAX_MS, EXTEND_MIN_MS } from '@shared/types'
import {
  ADD_TIME_MS, applyClockExtend, applyClockPause, applyClockStart, applyScore, applyUndo,
  errorCopy, signed, withDeadline, EVENT_FINISHED, TimeoutError,
  type ClockAction, type ExtendAction, type ScoreAction,
} from '@/routes/scorer/actions'
import {
  addTimeRefusal, clockRefusal, minusRefusal, REASONS, scoreRefusal, scorerRefusals, undoRefusal,
  CLOCK_RUNNING, CLOCK_UNSTARTED, EVENT_DONE, EXTEND_EVENT,
} from '@/routes/scorer/refusals'
import { loadLedger, pruneLedgers, saveLedger } from '@/routes/scorer/ledger'
import { fitsScorer } from '@/routes/scorer/viewport'
import {
  ALERT, CLOCK_ROW, COMMIT, CONTACT_LINE, HEAD_LINE, IPAD_SCREEN_HEIGHT, LINE,
  MAX_BROWSER_CHROME, MINUS_ROW, MOAT, PAD, REASON, RULE, SECONDARY, SHORTEST_VIEWPORT,
  STACK, STACK_COMMIT, STALE_LINE, columnBudget,
} from '@/routes/scorer/budget'
import { sampleMatch } from './fakes'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

function action(over: Partial<ScoreAction> = {}): ScoreAction {
  return { kind: 'score', seq: 1, athleteId: 100, name: 'Mateo Rivera', label: 'Takedown', points: 2, at: '2:14', ...over }
}

function clockAction(over: Partial<ClockAction> = {}): ClockAction {
  return { kind: 'clock', seq: 1, label: 'Clock paused', at: '2:14', ...over }
}

function extendAction(over: Partial<ExtendAction> = {}): ExtendAction {
  return { kind: 'extend', seq: 1, label: 'Time added', addMs: ADD_TIME_MS, at: '0:00', ...over }
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

  // The countdown, the expiry frame and the alarm all follow from the clock's length, so an
  // extension that moves it moves all three on the same frame the operator presses.
  it('adds the minute to the length, in both of the copies that carry it', () => {
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    const longer = applyClockExtend(expired, ADD_TIME_MS)
    expect(longer.clock.lengthMs).toBe(360_000)
    expect(longer.lengthSec).toBe(360)
    expect(longer.clock.elapsedMs).toBe(300_000)
    expect(longer.lastSeq).toBe(1)
  })

  it('takes the added minute back off an undo, length and all', () => {
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    const longer = applyClockExtend(expired, ADD_TIME_MS)
    const undone = applyUndo(longer, extendAction({ seq: 1 }))
    expect(undone.clock.lengthMs).toBe(300_000)
    expect(undone.lengthSec).toBe(300)
    expect(undone.lastSeq).toBe(0)
  })

  it('presses a minute at a time, inside the bounds the server accepts', () => {
    expect(ADD_TIME_MS).toBe(60_000)
    expect(ADD_TIME_MS).toBeGreaterThanOrEqual(EXTEND_MIN_MS)
    expect(ADD_TIME_MS).toBeLessThanOrEqual(EXTEND_MAX_MS)
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

  // G03: the event and the match both refuse with match_state and both say "done", and the
  // instruction is opposite. A finished event was being reported as a match to reopen from
  // a Live tab this tablet does not have and a screen that would refuse it anyway.
  it('separates a finished event from an ended match', () => {
    expect(errorCopy(new ApiError(409, 'match_state', 'event is done'))).toBe(EVENT_FINISHED)
    expect(errorCopy(new ApiError(409, 'match_state', 'event is done'))).not.toMatch(/Reopen it/)
  })

  it('says where a certified event is unlocked, which is not this tablet', () => {
    expect(errorCopy(new ApiError(409, 'match_state', 'event is certified'))).toBe(CERTIFIED_REFUSAL)
    expect(errorCopy(new ApiError(409, 'match_state', 'event is certified'))).not.toBe(EVENT_FINISHED)
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

  /**
   * G19. The extension is refused in exactly one state, and it is the opposite of the one
   * that refuses Start. That is what lets the two share the single reason line under their
   * row, and each sentence names the control it is about rather than the row.
   */
  describe('the add-time refusal', () => {
    const running = { ...live, clock: { ...live.clock, startedAt: '2026-10-03T16:00:00.000Z' } }
    const expired = { ...live, clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } }
    const paused = { ...live, clock: { elapsedMs: 45_000, startedAt: null, lengthMs: 300_000 } }

    it('refuses while the clock runs, and takes an expired or a paused one', () => {
      expect(addTimeRefusal(true, running, false)).toBe(CLOCK_RUNNING)
      expect(addTimeRefusal(true, expired, true)).toBeNull()
      expect(addTimeRefusal(true, paused, false)).toBeNull()
    })

    /**
     * M13. The extension exists to correct a clock that ran, and a match nobody has started
     * has not run: the control was live on every bout before its first Start, where the only
     * thing it does is lengthen the round without anyone deciding to.
     */
    it('refuses a match that has not started, where there is no clock to correct', () => {
      expect(addTimeRefusal(true, live, false)).toBe(CLOCK_UNSTARTED)
      // A clock reading zero because the match is over is a different fact, and it takes time.
      expect(addTimeRefusal(true, { ...live, clock: { elapsedMs: 0, startedAt: null, lengthMs: 0 } }, true)).toBeNull()
    })

    it('is never refused at the same time as the clock control beside it', () => {
      for (const [match, expired_] of [[running, false], [expired, true], [paused, false], [live, false]] as const) {
        const both = [clockRefusal(true, match, expired_), addTimeRefusal(true, match, expired_)].filter(r => r !== null)
        expect(both.length, JSON.stringify(match.clock)).toBeLessThanOrEqual(1)
      }
    })

    it('refuses with the whole screen when the screen is refusing', () => {
      expect(addTimeRefusal(false, paused, false)).toMatch(/Not connected/)
      expect(addTimeRefusal(true, null, false)).toMatch(/No match on this mat/)
      expect(addTimeRefusal(true, { ...paused, pendingTerminal: { athleteId: 200, actionKey: 'pin' } }, false)).toMatch(/result is waiting/)
    })
  })

  // Undo removes the newest event whatever it is, so it reaches an extension; a minus takes
  // a point back off one side, and an extension belongs to neither of them.
  it('lets undo reach an extension and keeps the minus off it', () => {
    const extended = { ...live, lastSeq: 1 }
    expect(undoRefusal(true, extended, extendAction({ seq: 1 }), true)).toBeNull()
    expect(minusRefusal(true, extended, extendAction({ seq: 1 }), 100)).toBe(EXTEND_EVENT)
  })

  /**
   * G03. After Finish the server refuses every write, so the event outranks whatever the
   * match itself would say. A tab that has not polled since has to refuse the tap rather
   * than send it and translate the answer.
   */
  it('refuses every control on a finished event, whatever the match says', () => {
    const refusals = scorerRefusals({ connected: true, eventStatus: 'done', match: live, last: null, expired: false })
    for (const [name, reason] of Object.entries(refusals)) expect(reason, name).toBe(EVENT_DONE)
  })

  // Certification only tightens the lock, so the tablet says the same thing it says
  // after Finish rather than inventing a second sentence for a stricter no.
  it('refuses every control on a certified event too', () => {
    const refusals = scorerRefusals({ connected: true, eventStatus: 'certified', match: live, last: null, expired: false })
    for (const [name, reason] of Object.entries(refusals)) expect(reason, name).toBe(EVENT_DONE)
  })

  it('leaves the controls to the match while the event is live', () => {
    const mid = { ...live, clock: { elapsedMs: 45_000, startedAt: null, lengthMs: 300_000 } }
    const refusals = scorerRefusals({ connected: true, eventStatus: 'live', match: mid, last: null, expired: false })
    expect(refusals.half).toBeNull()
    expect(refusals.clock).toBeNull()
    expect(refusals.addTime).toBeNull()
    expect(refusals.undo).toMatch(/Nothing to take back/)
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
  // arrangement exists to make. G09's contact line joins it, and is the last thing in.
  it('has room for the last action line and the contact line whenever the alarm is not showing', () => {
    const b = columnBudget(SHORTEST_VIEWPORT)
    expect(b.slack + ALERT).toBeGreaterThanOrEqual(LINE + CONTACT_LINE)
  })

  /**
   * G19's control had to fit a column with three pixels of slack at the shortest layout
   * viewport. It fits because it shares the clock's row rather than taking one: a second
   * 104px row would have put End match under the fold on every 1024 x 768 iPad, and the
   * arithmetic below is what says so rather than a hope.
   */
  it('pays for the add-time control out of the clock row, not out of the guarantee', () => {
    expect(CLOCK_ROW).toBe(COMMIT)
    expect(STACK_COMMIT).toBe(COMMIT + REASON + CLOCK_ROW + REASON + MOAT + RULE + COMMIT + 6 * 8)
    // A row of its own would not have fitted, which is the whole reason it shares one.
    const asOwnRow = columnBudget(SHORTEST_VIEWPORT).guaranteed + COMMIT + REASON
    expect(asOwnRow).toBeGreaterThan(SHORTEST_VIEWPORT)
  })

  it('keeps every box on the 4px grid and at or above the size 6.16 gives it', () => {
    expect(COMMIT).toBeGreaterThanOrEqual(104)
    expect(SECONDARY).toBeGreaterThanOrEqual(64)
    expect(MOAT).toBe(32)
    for (const box of [PAD, COMMIT, SECONDARY, REASON, MOAT, ALERT]) expect(box % 4).toBe(0)
  })
})

/**
 * M14. The shelf is session storage, which lives as long as the tab and is shared with
 * everything else this origin keeps there. A key per match, never removed, is a leak that
 * grows for exactly as long as one volunteer holds one mat.
 */
describe('the local ledger', () => {
  beforeEach(() => sessionStorage.clear())

  it('keeps only the current match, so a tab does not collect a ledger per bout', () => {
    for (const id of [10, 11, 12]) saveLedger(id, [action({ seq: 1 })])
    pruneLedgers(12)
    expect(loadLedger(12, 1)).toHaveLength(1)
    expect(loadLedger(10, 1)).toEqual([])
    expect(loadLedger(11, 1)).toEqual([])
  })

  it('leaves anything that is not a ledger alone', () => {
    sessionStorage.setItem('duels:something-else', 'kept')
    saveLedger(10, [action({ seq: 1 })])
    pruneLedgers(11)
    expect(sessionStorage.getItem('duels:something-else')).toBe('kept')
    expect(loadLedger(10, 1)).toEqual([])
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
