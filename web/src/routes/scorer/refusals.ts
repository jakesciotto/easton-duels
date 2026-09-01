import type { MatchView } from '@shared/types'
import type { LocalAction } from './actions'

/**
 * 6.16, refuse rather than reject: a control the state machine will turn down renders
 * disabled with the reason printed, rather than accepting a tap and answering with an
 * error a second later. Every reason is a sentence, because the person reading it is
 * looking away from a match and gets one glance.
 *
 * Every reason below is also short enough to paint inside the single line the centre
 * column reserves for it (budget.REASON). A second line would render over the control
 * underneath, which is why the suite asserts the length of each one.
 *
 * The deliberate inverse is that a paused clock refuses nothing: referees stop the clock
 * to award points, so no reason here may be derived from the clock running.
 */

export const OFFLINE = 'Not connected. Nothing will send.'
export const PENDING = 'A result is waiting. Record it.'
export const NOTHING = 'Nothing to take back yet.'
export const NO_MATCH = 'No match on this mat.'
export const ENDED = 'This match has ended.'
export const NOT_STARTED = 'This match has not started.'
export const TIME_UP = 'Time is up. Record the result.'
/** The expiry pause and both clock presses: the server's undo reaches none of them. */
export const CLOCK_EVENT = 'Undo does not reach the clock.'
export const ELSEWHERE = 'The newest action came from elsewhere.'

/** Every reason that prints in the reserved line, for the length check that guards it. */
export const REASONS = [
  OFFLINE, PENDING, NOTHING, NO_MATCH, ENDED, NOT_STARTED, TIME_UP, CLOCK_EVENT, ELSEWHERE,
]

function unavailable(connected: boolean, match: MatchView | null): string | null {
  if (!connected) return OFFLINE
  if (!match) return NO_MATCH
  if (match.status === 'done') return ENDED
  if (match.status !== 'live') return NOT_STARTED
  return null
}

/** Covers the whole half: the point buttons and the terminals behind the moat. */
export function scoreRefusal(connected: boolean, match: MatchView | null): string | null {
  const gone = unavailable(connected, match)
  if (gone) return gone
  return match!.pendingTerminal ? PENDING : null
}

export function clockRefusal(connected: boolean, match: MatchView | null, expired: boolean): string | null {
  const gone = unavailable(connected, match)
  if (gone) return gone
  if (match!.pendingTerminal) return PENDING
  // The server refuses clock_start once the elapsed time has reached the length, so the
  // only move left is to record the result.
  if (expired) return TIME_UP
  return null
}

/**
 * Undo removes the newest event and nothing else, so a tablet that cannot name that event
 * cannot say what the press would do. It refuses instead of guessing: the server turns down
 * an undo of a pause, including the one expiry writes, and an undo of a start stops a clock
 * nobody asked it to stop.
 */
export function undoRefusal(
  connected: boolean,
  match: MatchView | null,
  last: LocalAction | null,
  expired: boolean,
): string | null {
  const gone = unavailable(connected, match)
  if (gone) return gone
  if (match!.lastSeq === 0) return NOTHING
  if (!last || last.seq !== match!.lastSeq) return expired ? CLOCK_EVENT : ELSEWHERE
  if (last.kind === 'clock') return CLOCK_EVENT
  return null
}

/**
 * The per side affordance. The common error is the wrong side, so this one has to name
 * whose action it would take back, which means it refuses whenever this tablet cannot
 * see the newest event.
 */
export function minusRefusal(
  connected: boolean,
  match: MatchView | null,
  last: LocalAction | null,
  athleteId: number,
): string | null {
  const gone = unavailable(connected, match)
  if (gone) return gone
  if (match!.lastSeq === 0) return NOTHING
  if (!last || last.seq !== match!.lastSeq) return ELSEWHERE
  if (last.kind === 'clock') return CLOCK_EVENT
  // The only refusal that names a competitor, and so the only one that can outrun the
  // reserved line. It never prints there: it is raised for exactly one of the two sides,
  // and the line prints only what both of them, and Undo, refuse for.
  if (last.athleteId !== athleteId) return `The newest action was ${last.name}'s.`
  return null
}
