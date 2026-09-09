import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Snapshot } from '@shared/types'
import { farOf, useFar } from '@/routes/board/useFar'
import { setAdminToken } from '@/lib/auth'
import { fakeFetch, sampleSnapshot } from './fakes'

/**
 * G24. The far setting lived in one browser, so a second television, a cleared cache or a
 * laptop somebody swapped in reverted to 1.00 in front of the room. The event owns it now,
 * and the query string is still the setter: on a page holding an admin token it writes the
 * event rather than this browser.
 */
beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/board/1') })
afterEach(() => vi.unstubAllGlobals())

const at = (far: number | null): Snapshot => {
  const base = sampleSnapshot()
  return { ...base, event: { ...base.event, ...(far === null ? {} : { far }) } }
}

describe('farOf', () => {
  it('reads the event and answers null where it carries none', () => {
    expect(farOf(at(1.2))).toBe(1.2)
    expect(farOf(at(null))).toBeNull()
    expect(farOf(null)).toBeNull()
    expect(farOf(undefined)).toBeNull()
  })
})

describe('useFar', () => {
  it('reads the event first, so two televisions cannot disagree', () => {
    window.history.replaceState(null, '', '/board/1?far=0.85')
    localStorage.setItem('duels.board.far', '0.85')
    fakeFetch(() => ({ json: {} }))
    const { result } = renderHook(({ s }: { s: Snapshot | null }) => useFar(s), { initialProps: { s: at(1.2) } })
    expect(result.current).toBe(1.2)
  })

  it('falls back to the query string and then to storage while the event carries none', () => {
    fakeFetch(() => ({ json: {} }))
    localStorage.setItem('duels.board.far', '1.2')
    const stored = renderHook(() => useFar(at(null)))
    expect(stored.result.current).toBe(1.2)

    window.history.replaceState(null, '', '/board/1?far=0.85')
    localStorage.setItem('duels.board.far', '1.2')
    const queried = renderHook(() => useFar(at(null)))
    expect(queried.result.current).toBe(0.85)
  })

  it('holds the query string until the first snapshot lands', () => {
    window.history.replaceState(null, '', '/board/1?far=0.85')
    fakeFetch(() => ({ json: {} }))
    const { result } = renderHook(() => useFar(null))
    expect(result.current).toBe(0.85)
  })

  it('keeps a far out of the range 3.4 documents inside it', () => {
    fakeFetch(() => ({ json: {} }))
    expect(renderHook(() => useFar(at(4))).result.current).toBe(1.2)
    expect(renderHook(() => useFar(at(0.2))).result.current).toBe(0.85)
  })

  it('writes the query string onto the event once, from a page holding an admin token', async () => {
    setAdminToken('tok')
    window.history.replaceState(null, '', '/board/1?far=1.2')
    const f = fakeFetch(() => ({ json: {} }))
    const view = at(null)
    const { rerender } = renderHook(({ s }: { s: Snapshot | null }) => useFar(s), { initialProps: { s: view } })
    await act(async () => {})
    const patches = f.calls.filter(c => c.init?.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0].url).toBe(`/api/events/${view.event.id}`)
    expect(JSON.parse(String(patches[0].init?.body))).toEqual({ far: 1.2 })

    rerender({ s: at(1.2) })
    await act(async () => {})
    expect(f.calls.filter(c => c.init?.method === 'PATCH')).toHaveLength(1)
  })

  it('writes nothing from a television, which holds no token', async () => {
    window.history.replaceState(null, '', '/board/1?far=1.2')
    const f = fakeFetch(() => ({ json: {} }))
    renderHook(() => useFar(at(null)))
    await act(async () => {})
    expect(f.calls.filter(c => c.init?.method === 'PATCH')).toHaveLength(0)
  })

  it('still moves on the plus and minus keys while the event carries none', () => {
    fakeFetch(() => ({ json: {} }))
    const { result } = renderHook(() => useFar(at(null)))
    expect(result.current).toBe(1)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' })) })
    expect(result.current).toBe(1.2)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' })) })
    expect(result.current).toBe(1)
  })
})
