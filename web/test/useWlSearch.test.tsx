import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { SEARCH_PAUSE_MS, SEARCH_TOO_SHORT, useWlSearch } from '@/routes/event/useWlSearch'
import { setAdminToken } from '@/lib/auth'
import type { RosterCandidate } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok'); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const cand = (over: Partial<RosterCandidate> = {}): RosterCandidate => ({
  wlUid: 'u1', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Ridgeline',
  leaderboardId: null, erp: 5.2, age: 8, weightLbs: 60, gender: 'F', ...over,
})

/** Runs the clock forward and lets whatever it started settle. */
async function settle(ms = SEARCH_PAUSE_MS) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

const searches = (calls: { url: string }[]) => calls.filter(c => c.url.includes('/wl-search'))

describe('useWlSearch', () => {
  it('sends nothing and asks for two letters while the query is too short', async () => {
    const f = fakeFetch(() => ({ json: [] }))
    const { result } = renderHook(() => useWlSearch(7))
    expect(result.current.error).toBe('Type at least two letters.')

    act(() => result.current.setQ('m'))
    await settle(SEARCH_PAUSE_MS * 3)
    expect(searches(f.calls)).toHaveLength(0)
    expect(result.current.error).toBe('Type at least two letters.')
    expect(result.current.pending).toBe(false)
  })

  it('waits for the pause before it asks, then answers with the rows', async () => {
    const f = fakeFetch(() => ({ json: [cand()] }))
    const { result } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('martin'))
    await settle(SEARCH_PAUSE_MS - 1)
    expect(searches(f.calls)).toHaveLength(0)
    expect(result.current.pending).toBe(true)

    await settle(1)
    expect(searches(f.calls).map(c => c.url)).toEqual(['/api/events/7/wl-search?q=martin'])
    expect(result.current.results.map(c => c.wlUid)).toEqual(['u1'])
    expect(result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('asks once for a burst of keystrokes', async () => {
    const f = fakeFetch(() => ({ json: [cand()] }))
    const { result } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('ma'))
    await settle(100)
    act(() => result.current.setQ('mar'))
    await settle(100)
    act(() => result.current.setQ('martin'))
    await settle()

    expect(searches(f.calls).map(c => c.url)).toEqual(['/api/events/7/wl-search?q=martin'])
  })

  it('trims and encodes the query', async () => {
    const f = fakeFetch(() => ({ json: [] }))
    const { result } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('  nunez ortiz  '))
    await settle()
    expect(searches(f.calls)[0].url).toBe('/api/events/7/wl-search?q=nunez%20ortiz')
  })

  it('never lets a late answer overwrite a newer one', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    fakeFetch(async url => {
      if (url.endsWith('q=mar')) {
        await held
        return { json: [cand({ wlUid: 'stale' })] }
      }
      return { json: [cand({ wlUid: 'fresh' })] }
    })
    const { result } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('mar'))
    await settle()
    act(() => result.current.setQ('martin'))
    await settle()
    expect(result.current.results.map(c => c.wlUid)).toEqual(['fresh'])

    await act(async () => { release(); await Promise.resolve() })
    expect(result.current.results.map(c => c.wlUid)).toEqual(['fresh'])
  })

  it('reports a failure and clears the rows', async () => {
    fakeFetch(() => ({ status: 503, json: { error: { code: 'wl_not_configured', message: 'WellnessLiving credentials are not set' } } }))
    const { result } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('martin'))
    await settle()
    expect(result.current.error).toBe('WellnessLiving credentials are not set')
    expect(result.current.results).toEqual([])
    expect(result.current.pending).toBe(false)
  })

  it('drops the rows when the field falls back under the floor', async () => {
    fakeFetch(() => ({ json: [cand()] }))
    const { result } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('martin'))
    await settle()
    expect(result.current.results).toHaveLength(1)

    act(() => result.current.setQ(''))
    expect(result.current.results).toEqual([])
    expect(result.current.error).toBe(SEARCH_TOO_SHORT)
  })

  it('asks nothing once it is unmounted mid pause', async () => {
    const f = fakeFetch(() => ({ json: [] }))
    const { result, unmount } = renderHook(() => useWlSearch(7))

    act(() => result.current.setQ('martin'))
    unmount()
    await settle(SEARCH_PAUSE_MS * 2)
    expect(searches(f.calls)).toHaveLength(0)
  })
})
