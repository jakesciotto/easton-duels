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
})
