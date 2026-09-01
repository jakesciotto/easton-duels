import { STALE_POLL_MULTIPLIER } from './pollInterval'

// One shared fact -- lastSuccessAt, the timestamp of the last poll that actually reached the
// server -- drives both the clock's stale state (7.6) and the shell's freshness readout
// (6.4), so the two never disagree on how old the data is.

export function ageSeconds(lastSuccessAt: number | null, now: number): number | null {
  if (lastSuccessAt === null) return null
  return Math.max(0, Math.floor((now - lastSuccessAt) / 1000))
}

export function formatAge(ageSec: number): string {
  return `${ageSec}s`
}

// 7.6 / 7.15: the clock stops trusting its own numbers past three missed poll intervals.
// No lastSuccessAt at all means no data has ever arrived -- a loading state, not a stale one.
export function isStale(lastSuccessAt: number | null, now: number, pollIntervalMs: number): boolean {
  if (lastSuccessAt === null) return false
  return now - lastSuccessAt > pollIntervalMs * STALE_POLL_MULTIPLIER
}

export type FreshnessLevel = 'fresh' | 'attend' | 'fault'

/**
 * 6.4's status region, with two corrections that the running app forced.
 *
 * The threshold is measured against the POLL INTERVAL, not a fixed five seconds. The
 * interval is adaptive and reaches five seconds in data entry mode, so a fixed five
 * second threshold reports "late" once every single cycle on a perfectly healthy app.
 * Late means a poll has been MISSED, which is the same fact the clock's stale state
 * reads, so the two can never disagree about whether the data is old.
 *
 * The level is what the header renders, and the AGE is only printed once the level
 * leaves fresh. While the app is healthy the age is always under one interval, so a
 * number there counts seconds up and resets on every poll and tells the operator
 * nothing they can act on. The signal is that the data STOPPED arriving.
 */
export function headerFreshnessLevel(ageSec: number | null, pollIntervalMs: number): FreshnessLevel {
  if (ageSec === null) return 'fresh'
  const ageMs = ageSec * 1000
  if (ageMs <= pollIntervalMs * 2) return 'fresh'
  if (ageMs <= pollIntervalMs * STALE_POLL_MULTIPLIER) return 'attend'
  return 'fault'
}
