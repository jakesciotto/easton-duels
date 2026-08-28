import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ClockState } from '@shared/types'
import { useClock } from '@/lib/useClock'

afterEach(() => vi.useRealTimers())

describe('useClock', () => {
  it('counts down from the server timestamp and stays still when paused', () => {
    const T0 = Date.parse('2026-10-03T16:00:00.000Z')
    vi.useFakeTimers({ now: T0 + 5_000 })
    const running: ClockState = { elapsedMs: 10_000, startedAt: new Date(T0).toISOString(), lengthMs: 300_000 }
    const { result, rerender } = renderHook(({ clock }) => useClock(clock, new Date(T0).toISOString()), { initialProps: { clock: running } })
    expect(result.current.running).toBe(true)
    expect(result.current.remainingMs).toBe(290_000)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current.remainingMs).toBe(289_000)
    rerender({ clock: { ...running, startedAt: null, elapsedMs: 12_000 } })
    expect(result.current.running).toBe(false)
    expect(result.current.remainingMs).toBe(288_000)
  })
})
