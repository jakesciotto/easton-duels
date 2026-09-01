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

// 6.4: the shell's status region degrades on fixed poll age, not on the adaptive interval --
// gray-11 under 5s, attend past 5s, fault past 15s. Null (no poll has landed yet) is the
// caller's job to render as a distinct connecting state.
export function headerFreshnessLevel(ageSec: number | null): FreshnessLevel {
  if (ageSec === null || ageSec <= 5) return 'fresh'
  if (ageSec <= 15) return 'attend'
  return 'fault'
}
