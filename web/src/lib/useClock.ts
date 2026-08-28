import { useEffect, useState } from 'react'
import type { ClockState } from '@shared/types'
import { remainingMs } from '@shared/clock'

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

export function useClock(clock: ClockState | null, serverNow: string | null): { remainingMs: number; running: boolean } {
  const offset = useServerOffset(serverNow)
  const running = clock !== null && clock.startedAt !== null
  const now = useNow(running)
  if (!clock) return { remainingMs: 0, running: false }
  return { remainingMs: remainingMs(clock, now + offset), running }
}
