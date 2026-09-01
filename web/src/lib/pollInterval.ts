import type { Snapshot } from '@shared/types'

// Section 7.15. The clock is the fastest-changing value on any surface, so it sets the
// ceiling; an event with nothing running can afford to ask less often.
export const POLL_CLOCK_RUNNING_MS = 1000
export const POLL_LIVE_IDLE_MS = 3000
export const POLL_DATA_ENTRY_MS = 5000

// The clock's stale state (7.6) fires past this many missed intervals.
export const STALE_POLL_MULTIPLIER = 3

// No snapshot has landed yet: poll at the fast rate until the first one arrives and tells
// us what the event actually looks like.
//
// How the event runs is a stored fact now, so the ramp reads it rather than guessing. The
// guess was "zero mats means data entry", which is wrong for the normal desk event: an
// entry event still has mats, because they hold the running order for the desk to read.
// Guessing polled every desk screen five times faster than it needs for the whole
// afternoon, and it was a second place deciding a question the column already answers.
export function pollIntervalForSnapshot(snapshot: Snapshot | null): number {
  if (!snapshot) return POLL_CLOCK_RUNNING_MS
  if (snapshot.event.mode === 'entry') return POLL_DATA_ENTRY_MS
  if (snapshot.mats.length === 0) return POLL_DATA_ENTRY_MS
  const clockRunning = snapshot.mats.some(mat => mat.current !== null && mat.current.clock.startedAt !== null)
  return clockRunning ? POLL_CLOCK_RUNNING_MS : POLL_LIVE_IDLE_MS
}

/**
 * The floor on a poll's deadline. A request that outlives three intervals is not slow, it is
 * a socket the network dropped without closing, and the app has to notice rather than wait.
 */
export const POLL_DEADLINE_MIN_MS = 4000
