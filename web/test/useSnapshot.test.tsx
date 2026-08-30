import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSnapshot, mergeSnapshot } from '@/lib/useSnapshot'
import { FakeEventSource, sampleSnapshot } from './fakes'

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

describe('mergeSnapshot', () => {
  it('ignores an older version', () => {
    const v2 = sampleSnapshot({ version: 2 })
    const v1 = sampleSnapshot({ version: 1 })
    expect(mergeSnapshot(v2, v1)).toBe(v2)
    expect(mergeSnapshot(v1, v2)).toBe(v2)
    expect(mergeSnapshot(null, v1)).toBe(v1)
  })
})

describe('useSnapshot', () => {
  it('opens one stream per event, applies snapshots, tracks connection, and closes on unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const { result, unmount } = renderHook(() => useSnapshot(1))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/events/1/stream')
    expect(result.current.connected).toBe(false)
    act(() => FakeEventSource.instances[0].emit('snapshot', sampleSnapshot({ version: 5 })))
    expect(result.current.snapshot?.version).toBe(5)
    expect(result.current.connected).toBe(true)
    act(() => FakeEventSource.instances[0].fail())
    expect(result.current.connected).toBe(false)
    expect(result.current.snapshot?.version).toBe(5)
    unmount()
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })
  it('ignores an older version inside one connection', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const { result } = renderHook(() => useSnapshot(1))
    act(() => FakeEventSource.instances[0].emit('snapshot', sampleSnapshot({ version: 5 })))
    act(() => FakeEventSource.instances[0].emit('snapshot', sampleSnapshot({ version: 3 })))
    expect(result.current.snapshot?.version).toBe(5)
  })

  it('accepts the first snapshot after a reconnect even when the server restarted its versions', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const { result } = renderHook(() => useSnapshot(1))
    act(() => FakeEventSource.instances[0].emit('snapshot', sampleSnapshot({ version: 40 })))
    expect(result.current.snapshot?.version).toBe(40)
    act(() => FakeEventSource.instances[0].fail())
    expect(result.current.connected).toBe(false)
    act(() => FakeEventSource.instances[0].emit('snapshot', sampleSnapshot({ version: 1, now: '2026-10-03T17:00:00.000Z' })))
    expect(result.current.snapshot?.version).toBe(1)
    expect(result.current.snapshot?.now).toBe('2026-10-03T17:00:00.000Z')
    expect(result.current.connected).toBe(true)
  })

  it('drops the held snapshot when the event id changes', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const { result, rerender } = renderHook(({ id }: { id: number }) => useSnapshot(id), { initialProps: { id: 1 } })
    act(() => FakeEventSource.instances[0].emit('snapshot', sampleSnapshot({ version: 40 })))
    expect(result.current.snapshot?.version).toBe(40)
    rerender({ id: 2 })
    expect(result.current.snapshot).toBeNull()
    expect(result.current.connected).toBe(false)
    expect(FakeEventSource.instances[1].url).toBe('/api/events/2/stream')
  })

  it('does nothing for a null event id', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    renderHook(() => useSnapshot(null))
    expect(FakeEventSource.instances).toHaveLength(0)
  })
})
