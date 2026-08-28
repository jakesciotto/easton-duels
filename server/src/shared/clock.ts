import type { ClockState } from './types.js'

export function remainingMs(clock: ClockState, nowMs: number): number {
  const running = clock.startedAt ? Math.max(0, nowMs - Date.parse(clock.startedAt)) : 0
  return Math.max(0, clock.lengthMs - clock.elapsedMs - running)
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function isRunning(clock: ClockState): boolean {
  return clock.startedAt !== null
}
