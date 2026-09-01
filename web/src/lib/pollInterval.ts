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
// Zero mats stands in for "data entry mode" here: there is no persisted event-wide mode
// flag yet (the runtime choice is still made at the pilot's dress rehearsal, per the brief),
// and an event with no mats bound can have no running clock at all, which is the one fact
// 7.15's data entry row actually depends on.
export function pollIntervalForSnapshot(snapshot: Snapshot | null): number {
  if (!snapshot) return POLL_CLOCK_RUNNING_MS
  if (snapshot.mats.length === 0) return POLL_DATA_ENTRY_MS
  const clockRunning = snapshot.mats.some(mat => mat.current !== null && mat.current.clock.startedAt !== null)
  return clockRunning ? POLL_CLOCK_RUNNING_MS : POLL_LIVE_IDLE_MS
}
