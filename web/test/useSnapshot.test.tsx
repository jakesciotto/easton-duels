import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSnapshot } from '@/lib/useSnapshot'
import { fakeFetch, sampleSnapshot } from './fakes'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('useSnapshot', () => {
  it('stores the first snapshot and sets connected', async () => {
    fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    const { result } = renderHook(() => useSnapshot(1))
    expect(result.current.connected).toBe(false)
    await flush()
    expect(result.current.snapshot?.version).toBe(1)
    expect(result.current.connected).toBe(true)
  })

  it('keeps the same snapshot object identity on an unchanged { version, now } response', async () => {
    const snap = sampleSnapshot({ version: 1 })
    let call = 0
    fakeFetch(() => {
      call += 1
      return call === 1 ? { json: { version: 1, snapshot: snap } } : { json: { version: 1, now: snap.now } }
    })
    const { result } = renderHook(() => useSnapshot(1))
    await flush()
    const first = result.current.snapshot
    expect(first?.version).toBe(1)
    await flush(1000)
    expect(result.current.snapshot).toBe(first)
    expect(result.current.connected).toBe(true)
  })

  it('replaces the snapshot on a newer version', async () => {
    let call = 0
    fakeFetch(() => {
      call += 1
      return call === 1
        ? { json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }
        : { json: { version: 2, snapshot: sampleSnapshot({ version: 2 }) } }
    })
    const { result } = renderHook(() => useSnapshot(1))
    await flush()
    const first = result.current.snapshot
    expect(first?.version).toBe(1)
    await flush(1000)
    expect(result.current.snapshot).not.toBe(first)
    expect(result.current.snapshot?.version).toBe(2)
  })

  it('flips connected false after three consecutive failed polls, and a success flips it back', async () => {
    let call = 0
    fakeFetch(() => {
      call += 1
      if (call === 1) return { json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }
      if (call <= 4) throw new Error('network error')
      return { json: { version: 1, now: sampleSnapshot({ version: 1 }).now } }
    })
    const { result } = renderHook(() => useSnapshot(1))
    await flush()
    expect(result.current.connected).toBe(true)
    await flush(1000) // failure 1
    expect(result.current.connected).toBe(true)
    await flush(1000) // failure 2
    expect(result.current.connected).toBe(true)
    await flush(1000) // failure 3 -- flips false
    expect(result.current.connected).toBe(false)
    await flush(1000) // success -- flips back
    expect(result.current.connected).toBe(true)
  })

  it('stops polling on unmount', async () => {
    const f = fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    const { unmount } = renderHook(() => useSnapshot(1))
    await flush()
    const callsAtUnmount = f.calls.length
    expect(callsAtUnmount).toBeGreaterThan(0)
    unmount()
    await flush(5000)
    expect(f.calls.length).toBe(callsAtUnmount)
  })

  it('polls at once when the tab becomes visible again', async () => {
    const f = fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    const { unmount } = renderHook(() => useSnapshot(1, 60_000))
    try {
      await flush()
      expect(f.calls.length).toBe(0)
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await flush()
      // No timer was advanced: the wake-up polled instead of waiting out the interval.
      expect(f.calls.length).toBe(1)
      unmount()
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await flush()
      expect(f.calls.length).toBe(1)
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
  })

  it('pauses polling while document.hidden is true', async () => {
    const f = fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      renderHook(() => useSnapshot(1))
      await flush()
      expect(f.calls.length).toBe(0)
      await flush(5000)
      expect(f.calls.length).toBe(0)
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
      await flush(1000)
      expect(f.calls.length).toBeGreaterThan(0)
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
  })
})
