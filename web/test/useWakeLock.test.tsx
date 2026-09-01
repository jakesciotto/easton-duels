import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWakeLock } from '@/lib/useWakeLock'

afterEach(() => vi.unstubAllGlobals())

describe('useWakeLock', () => {
  it('degrades silently with no support signalled', async () => {
    vi.stubGlobal('navigator', {})
    const { result } = renderHook(() => useWakeLock())
    expect(result.current.supported).toBe(false)
    await act(async () => { await result.current.request() })
    expect(result.current.active).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  it('acquires on request and marks failed on rejection', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn()
      .mockResolvedValueOnce({ addEventListener: vi.fn(), release })
      .mockRejectedValueOnce(new Error('not allowed'))
    vi.stubGlobal('navigator', { wakeLock: { request } })

    const { result } = renderHook(() => useWakeLock())
    expect(result.current.supported).toBe(true)

    await act(async () => { await result.current.request() })
    expect(result.current.active).toBe(true)
    expect(result.current.failed).toBe(false)
  })

  it('reports a rejected request as failed, not active', async () => {
    const request = vi.fn().mockRejectedValue(new Error('not allowed'))
    vi.stubGlobal('navigator', { wakeLock: { request } })

    const { result } = renderHook(() => useWakeLock())
    await act(async () => { await result.current.request() })
    expect(result.current.active).toBe(false)
    expect(result.current.failed).toBe(true)
  })

  // R6: two callers of the same hook instance (the hook's own visibility handler
  // and a caller's own effect) can both call request() on the same tick. Without
  // one shared in-flight guard both pass the async gap before either sets the
  // lock ref, acquiring two sentinels of which only one is ever tracked.
  it('shares one in-flight guard, so two concurrent requests acquire exactly one sentinel', async () => {
    let resolveLock!: (lock: { addEventListener: ReturnType<typeof vi.fn>; release: () => Promise<void> }) => void
    const request = vi.fn(() => new Promise(resolve => { resolveLock = resolve }))
    vi.stubGlobal('navigator', { wakeLock: { request } })

    const { result } = renderHook(() => useWakeLock())
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.request()
      second = result.current.request()
    })
    // Both calls started before either resolved, so the guard -- not a resolved
    // lock ref -- is what stopped the second from reaching navigator.wakeLock.
    expect(request).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveLock({ addEventListener: vi.fn(), release: vi.fn(async () => {}) })
      await Promise.all([first, second])
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current.active).toBe(true)

    // A request made while the lock is still held must not acquire a second
    // sentinel. A caller whose effect re-runs one commit after the first request
    // resolves would otherwise leak one, because nothing tracks or releases it.
    await act(async () => { await result.current.request() })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('acquires again once the operating system releases the lock', async () => {
    const listeners: Array<() => void> = []
    const request = vi.fn(async () => ({
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      release: async () => {},
    }))
    vi.stubGlobal('navigator', { wakeLock: { request } })

    const { result } = renderHook(() => useWakeLock())
    await act(async () => { await result.current.request() })
    expect(result.current.active).toBe(true)

    // The operating system drops the lock on a visibility change and fires release,
    // which nulls the lock ref. Only then may a caller take a new one.
    await act(async () => { listeners.forEach(fn => fn()) })
    expect(result.current.active).toBe(false)

    await act(async () => { await result.current.request() })
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.current.active).toBe(true)
  })
})
