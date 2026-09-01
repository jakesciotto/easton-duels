import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { useMemo } from 'react'
import { renderHook, render, act } from '@testing-library/react'
import { SnapshotStreamContext, useSnapshot } from '@/lib/useSnapshot'
import { fakeFetch, sampleSnapshot, snapshotFeed } from './fakes'

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
    const { result } = renderHook(() => useSnapshot(1, 1000))
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
    const { result } = renderHook(() => useSnapshot(1, 1000))
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
    const { result } = renderHook(() => useSnapshot(1, 1000))
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

  it('does not start a second poll chain when visibilitychange fires during an in-flight fetch', async () => {
    let resolveFetch: ((r: Response) => void) | null = null
    let callCount = 0
    const fn = vi.fn(() => {
      callCount += 1
      return new Promise<Response>(resolve => { resolveFetch = resolve })
    })
    vi.stubGlobal('fetch', fn)

    renderHook(() => useSnapshot(1, 1000))
    await flush()
    expect(callCount).toBe(1)

    // Simulates an iPad locking and unlocking again while the current poll is still
    // awaiting its response: wake() must not start a second chain on top of it.
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(callCount).toBe(1)

    await act(async () => {
      resolveFetch!(new Response(JSON.stringify({ version: 1, snapshot: sampleSnapshot({ version: 1 }) }), { status: 200, headers: { 'content-type': 'application/json' } }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(callCount).toBe(1)

    // Only the in-flight chain's own next tick fires -- not a second, parallel one.
    await flush(1000)
    expect(callCount).toBe(2)
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

  it('exposes lastSuccessAt as null until the first poll lands, then as the receipt time', async () => {
    fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    const { result } = renderHook(() => useSnapshot(1, 1000))
    expect(result.current.lastSuccessAt).toBeNull()
    await flush()
    expect(result.current.lastSuccessAt).not.toBeNull()
  })

  it('derives the poll interval from event state when the caller does not pin one', async () => {
    // The default sample snapshot is one mat with no clock running, so the derivation
    // (pollInterval.ts) picks the live-idle rate, not a flat 1000ms.
    const f = fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    renderHook(() => useSnapshot(1))
    await flush()
    expect(f.calls.length).toBe(1)
    await flush(2999)
    expect(f.calls.length).toBe(1)
    await flush(1)
    expect(f.calls.length).toBe(2)
  })

  it('holds an arriving snapshot while an input is focused, and commits it once the recheck sees the field free', async () => {
    let call = 0
    fakeFetch(() => {
      call += 1
      return call === 1
        ? { json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }
        : { json: { version: 2, snapshot: sampleSnapshot({ version: 2 }) } }
    })
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      const { result } = renderHook(() => useSnapshot(1, 1000))
      await flush()
      expect(result.current.snapshot?.version).toBe(1)

      input.focus()
      await flush(1000) // the newer version arrives while the field is focused
      expect(result.current.snapshot?.version).toBe(1)

      input.blur()
      await flush(200) // the suspension recheck notices the field is free again
      expect(result.current.snapshot?.version).toBe(2)
    } finally {
      input.remove()
    }
  })

  it('holds an arriving snapshot while a tab root is mid drag', async () => {
    let call = 0
    fakeFetch(() => {
      call += 1
      return call === 1
        ? { json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }
        : { json: { version: 2, snapshot: sampleSnapshot({ version: 2 }) } }
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    try {
      const { result } = renderHook(() => useSnapshot(1, 1000))
      await flush()
      expect(result.current.snapshot?.version).toBe(1)

      root.setAttribute('data-dragging', '1')
      await flush(1000)
      expect(result.current.snapshot?.version).toBe(1)

      root.setAttribute('data-dragging', 'false')
      await flush(200)
      expect(result.current.snapshot?.version).toBe(2)
    } finally {
      root.remove()
    }
  })

  // 6.4: three loops against one endpoint from one browser tab meant three request rates
  // and three version cursors, and a header that could report a freshness the tab under it
  // did not have.
  it('serves every consumer under the event body from one poll loop', async () => {
    const f = fakeFetch(() => ({ json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }))
    function Consumer({ eventId }: { eventId: number }) {
      useSnapshot(eventId, 1000)
      return null
    }
    function Body() {
      const stream = useSnapshot(1, 1000)
      const shared = useMemo(() => ({ eventId: 1, state: stream }), [stream])
      return (
        <SnapshotStreamContext value={shared}>
          <Consumer eventId={1} />
          <Consumer eventId={1} />
          {/* Another event is not this provider's, so it keeps its own loop. */}
          <Consumer eventId={2} />
        </SnapshotStreamContext>
      )
    }
    render(<Body />)
    await flush()
    const forEvent = (id: number) => f.calls.filter(c => c.url.startsWith(`/api/events/${id}/snapshot`)).length
    expect(forEvent(1)).toBe(1)
    expect(forEvent(2)).toBe(1)
    await flush(1000)
    expect(forEvent(1)).toBe(2)
  })

  // 4.4 / WCAG 2.2.2. The pause lives on the stream, not on one screen, so the shell can
  // report it: a header driven by lastSuccessAt alone reads "Live 1s" over a frozen rack.
  it('freezes the picture while paused, counts what is waiting underneath, and releases the newest', async () => {
    const feed = snapshotFeed(sampleSnapshot({ version: 1 }))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    const { result } = renderHook(() => useSnapshot(1, 1000))
    await flush()
    expect(result.current.snapshot?.version).toBe(1)
    expect(result.current.paused).toBe(false)

    act(() => { result.current.setPaused(true) })
    const at = result.current.lastSuccessAt
    feed.push(sampleSnapshot({}))
    await flush(1000)
    expect(result.current.paused).toBe(true)
    expect(result.current.snapshot?.version).toBe(1)
    expect(result.current.waiting).toBe(1)
    // The poll keeps running underneath, which is the only way the wait can be counted.
    expect(result.current.lastSuccessAt).not.toBe(at)

    act(() => { result.current.setPaused(false) })
    expect(result.current.paused).toBe(false)
    expect(result.current.waiting).toBe(0)
    expect(result.current.snapshot?.version).toBe(2)
  })

  it('keeps only the most recent held snapshot when two arrive back to back while engaged', async () => {
    let call = 0
    fakeFetch(() => {
      call += 1
      if (call === 1) return { json: { version: 1, snapshot: sampleSnapshot({ version: 1 }) } }
      if (call === 2) return { json: { version: 2, snapshot: sampleSnapshot({ version: 2 }) } }
      return { json: { version: 3, snapshot: sampleSnapshot({ version: 3 }) } }
    })
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      const { result } = renderHook(() => useSnapshot(1, 1000))
      await flush()
      input.focus()
      await flush(1000)
      await flush(1000)
      expect(result.current.snapshot?.version).toBe(1)

      input.blur()
      await flush(400)
      expect(result.current.snapshot?.version).toBe(3)
    } finally {
      input.remove()
    }
  })
})
