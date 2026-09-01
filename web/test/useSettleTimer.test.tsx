import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { HOLD_MS, useSettleTimer } from '@/routes/board/useSettleTimer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useSettleTimer', () => {
  it('treats the first batch as history so a reload does not flash stale results', () => {
    const { result } = renderHook(() => useSettleTimer([7, 9], true))
    expect([...result.current].sort()).toEqual([7, 9])
  })

  it('settles nothing until the first snapshot has landed', () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }) => useSettleTimer(ids, ready),
      { initialProps: { ids: [] as number[], ready: false } },
    )
    act(() => { vi.advanceTimersByTime(HOLD_MS + 100) })
    expect(result.current.size).toBe(0)
    rerender({ ids: [4], ready: true })
    expect(result.current.has(4)).toBe(true)
  })

  it('holds a result that arrives later, then settles it', () => {
    const { result, rerender } = renderHook(({ ids }) => useSettleTimer(ids, true), { initialProps: { ids: [7] } })
    rerender({ ids: [7, 8] })
    expect(result.current.has(8)).toBe(false)

    act(() => { vi.advanceTimersByTime(HOLD_MS - 1000) })
    expect(result.current.has(8)).toBe(false)

    act(() => { vi.advanceTimersByTime(1100) })
    expect(result.current.has(8)).toBe(true)
  })

  it('forgets an id that stops being shown', () => {
    const { result, rerender } = renderHook(({ ids }) => useSettleTimer(ids, true), { initialProps: { ids: [7] } })
    rerender({ ids: [] })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 100) })
    expect(result.current.size).toBe(0)
  })
})
