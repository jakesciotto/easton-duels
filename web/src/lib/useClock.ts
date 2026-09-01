import { useEffect, useState } from 'react'
import type { ClockState } from '@shared/types'
import { remainingMs } from '@shared/clock'
import { ageSeconds, isStale } from './freshness'
import { POLL_CLOCK_RUNNING_MS } from './pollInterval'

// Device clock minus server clock, refreshed on every snapshot.
export function useServerOffset(serverNow: string | null): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (serverNow) setOffset(Date.parse(serverNow) - Date.now())
  }, [serverNow])
  return offset
}

export function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return now
}

export interface ClockReadout {
  remainingMs: number
  running: boolean
  // 7.6's fifth state: no snapshot for more than three poll intervals. `ageSec` is the
  // same measured age the shell's freshness readout prints, so the two can never disagree.
  stale: boolean
  ageSec: number | null
}

export function useClock(
  clock: ClockState | null,
  serverNow: string | null,
  lastSuccessAt: number | null = null,
  pollIntervalMs: number = POLL_CLOCK_RUNNING_MS,
): ClockReadout {
  const offset = useServerOffset(serverNow)
  const running = clock !== null && clock.startedAt !== null
  // The stale annotation reads a live "Ns" even on a paused clock, so the tick stays live
  // whenever there is a lastSuccessAt to age -- not only while the clock itself is running.
  const now = useNow(running || lastSuccessAt !== null)
  const ageSec = ageSeconds(lastSuccessAt, now)
  const stale = isStale(lastSuccessAt, now, pollIntervalMs)
  if (!clock) return { remainingMs: 0, running: false, stale, ageSec }
  return { remainingMs: remainingMs(clock, now + offset), running, stale, ageSec }
}
