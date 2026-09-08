import type { MatchView } from '@shared/types'
import { ApiError } from '@/lib/api'

/**
 * What this tablet recorded. A snapshot carries the derived match and nothing else, so a
 * scorer that reloaded mid match knows nothing about the taps before it, and every
 * affordance that has to name one refuses instead of guessing at it.
 */
interface Recorded {
  /** The match lastSeq this action produced. It is what ties a log entry to server state. */
  seq: number
  /** The clock reading when it was recorded, so the coach can reconcile against the referee. */
  at: string
}

export interface ScoreAction extends Recorded {
  kind: 'score'
  athleteId: number
  name: string
  label: string
  points: number
}

/**
 * Clock presses are recorded too. The server's undo removes the newest event and nothing
 * else: it refuses to remove a pause, and removing a start silently stops a running clock.
 * A tablet that did not know the newest event was its own clock press would offer a generic
 * Undo for both of those, so the press is written down in order to be refused by name.
 */
export interface ClockAction extends Recorded {
  kind: 'clock'
  label: 'Clock started' | 'Clock paused'
}

/**
 * An extension is written down for the opposite reason: the server removes it like any
 * other event, so Undo has to be able to name it and take it back rather than refuse for a
 * newest event it cannot see.
 */
export interface ExtendAction extends Recorded {
  kind: 'extend'
  label: 'Time added'
  addMs: number
}

export type LocalAction = ScoreAction | ClockAction | ExtendAction

/** 6.16 and G19: one control, one minute a press, inside the server's own bounds. */
export const ADD_TIME_MS = 60_000

export function signed(points: number): string {
  return points >= 0 ? `+${points}` : String(points)
}

/**
 * A write that never settles is indistinguishable from one still in flight, and the serial
 * chain behind it never drains: every later tap queues against a socket the room's access
 * point dropped without a reset, and the sheet's own buttons stay disabled with the modal
 * up. The deadline turns a hang into a rejection the rollback path already handles. It
 * bounds the whole attempt ladder rather than one request, because what is waiting is an
 * operator, not a retry policy.
 */
export const WRITE_DEADLINE_MS = 8_000

export class TimeoutError extends Error {
  constructor() {
    super('write deadline')
    this.name = 'TimeoutError'
  }
}

export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    work.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * 4.1: a score tap, a clock start, a clock pause and an undo all paint at 0ms and
 * reconcile with the server after. Each fold carries the predicate that says whether it is
 * still needed, because the authoritative snapshot can arrive carrying the same write and
 * folding it twice would double the point.
 */
export function applyScore(match: MatchView, athleteId: number, points: number): MatchView {
  const next = { ...match, lastSeq: match.lastSeq + 1 }
  if (match.a.athleteId === athleteId) next.a = { ...match.a, score: match.a.score + points }
  else next.b = { ...match.b, score: match.b.score + points }
  return next
}

export function applyClockStart(match: MatchView, atIso: string): MatchView {
  return { ...match, lastSeq: match.lastSeq + 1, clock: { ...match.clock, startedAt: atIso } }
}

export function applyClockPause(match: MatchView, nowMs: number): MatchView {
  const ran = match.clock.startedAt ? Math.max(0, nowMs - Date.parse(match.clock.startedAt)) : 0
  return {
    ...match,
    lastSeq: match.lastSeq + 1,
    clock: { ...match.clock, startedAt: null, elapsedMs: Math.min(match.clock.lengthMs, match.clock.elapsedMs + ran) },
  }
}

/**
 * The clock's length carries every extension, so the countdown, the expiry frame and the
 * expired tone all follow from this one fold. `lengthSec` is the same number in seconds and
 * moves with it, because the board and the head line read that copy rather than the clock.
 */
export function applyClockExtend(match: MatchView, addMs: number): MatchView {
  return {
    ...match,
    lastSeq: match.lastSeq + 1,
    lengthSec: match.lengthSec + addMs / 1000,
    clock: { ...match.clock, lengthMs: match.clock.lengthMs + addMs },
  }
}

/**
 * `undone` is supplied only when this tablet recorded the newest event AND that event was a
 * score or an extension, which is the same condition the global undo is gated on. Without it
 * the seq still steps back, because the server will accept the undo either way and the
 * value simply reconciles a poll later.
 */
export function applyUndo(match: MatchView, undone: ScoreAction | ExtendAction | null): MatchView {
  const next = { ...match, lastSeq: Math.max(0, match.lastSeq - 1) }
  if (!undone) return next
  if (undone.kind === 'extend') {
    next.lengthSec = match.lengthSec - undone.addMs / 1000
    next.clock = { ...match.clock, lengthMs: match.clock.lengthMs - undone.addMs }
    return next
  }
  if (match.a.athleteId === undone.athleteId) next.a = { ...match.a, score: match.a.score - undone.points }
  else next.b = { ...match.b, score: match.b.score - undone.points }
  return next
}

/**
 * The one sentence a finished event gets, on the done screen and against a write from a tab
 * that has not polled since Finish. Both surfaces say it in the same words, because a
 * volunteer who reads one and then the other is reading about the same fact.
 */
export const EVENT_FINISHED = 'This event is finished. Nothing more is scored on this iPad.'

// 7.12: the server's taxonomy is actionable and has to reach the operator as an
// instruction. Anything unmapped keeps the server's own sentence, which is already
// written for a person ("clock already running", "nothing to undo").
export function errorCopy(e: unknown): string {
  // A deadline says nothing about whether the write landed, so it must not claim it did not.
  if (e instanceof TimeoutError) return 'No answer from the server. Check the score before trying that again.'
  if (!(e instanceof ApiError)) return 'Could not reach the server. That did not send. Try it again.'
  if (e.code === 'sequence') return 'Another device scored this mat first. Refreshing now.'
  if (e.status === 429) return 'Too many attempts. Try again in a minute.'
  if (e.status >= 500) return 'The server had a problem. Try that again.'
  // The event and the match both refuse with `match_state` and both say "done", and the
  // instruction is opposite: a match can be reopened, a finished event cannot. This one is
  // tested first, because the match sentence matches its words too.
  if (e.code === 'match_state' && /\bevent is done\b/.test(e.message)) return EVENT_FINISHED
  if (e.code === 'match_state' && /\bdone\b/.test(e.message)) {
    return 'This match already ended. Reopen it from the Live tab to change the result.'
  }
  return e.message
}
