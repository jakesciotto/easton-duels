import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecentResults } from '@/routes/board/useRecentResults'
import { sampleMatch, sampleSnapshot } from './fakes'

afterEach(() => vi.useRealTimers())

describe('useRecentResults', () => {
  it('remembers a mat\'s finished match for 10 seconds after it leaves the tile', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const live = sampleMatch({ id: 10 })
    const next = sampleMatch({ id: 11, status: 'live' })
    const s1 = sampleSnapshot({ version: 1, mats: [{ id: 1, number: 1, current: live, onDeck: [next], bound: true }], matches: [live, next] })
    const { result, rerender } = renderHook(({ s }) => useRecentResults(s), { initialProps: { s: s1 } })
    expect(result.current.size).toBe(0)
    const done = { ...live, status: 'done' as const, result: { winnerAthleteId: 100, winType: 'points' as const } }
    const s2 = sampleSnapshot({ version: 2, mats: [{ id: 1, number: 1, current: next, onDeck: [], bound: true }], matches: [done, next] })
    rerender({ s: s2 })
    expect(result.current.get(1)?.match.id).toBe(10)
    vi.advanceTimersByTime(10_001)
    rerender({ s: { ...s2, version: 3 } })
    expect(result.current.size).toBe(0)
  })

  it('does not extend the hold when unrelated snapshots keep arriving', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const live = sampleMatch({ id: 10 })
    const next = sampleMatch({ id: 11, status: 'live' })
    const s1 = sampleSnapshot({ version: 1, mats: [{ id: 1, number: 1, current: live, onDeck: [next], bound: true }], matches: [live, next] })
    const { result, rerender } = renderHook(({ s }) => useRecentResults(s), { initialProps: { s: s1 } })
    const done = { ...live, status: 'done' as const, result: { winnerAthleteId: 100, winType: 'points' as const } }
    const s2 = sampleSnapshot({ version: 2, mats: [{ id: 1, number: 1, current: next, onDeck: [], bound: true }], matches: [done, next] })
    rerender({ s: s2 })
    expect(result.current.get(1)?.match.id).toBe(10)

    // Unrelated snapshots arrive at t0+4s and t0+9s: same mats and matches,
    // just a version bump, as a heartbeat or another mat's update would look.
    vi.advanceTimersByTime(4_000)
    rerender({ s: { ...s2, version: 3 } })
    expect(result.current.get(1)?.match.id).toBe(10)

    vi.advanceTimersByTime(5_000)
    rerender({ s: { ...s2, version: 4 } })
    expect(result.current.get(1)?.match.id).toBe(10)

    // No further snapshot arrives. If the hold were being reset by each
    // unrelated snapshot above, the entry would still be showing at t0+10.1s.
    act(() => { vi.advanceTimersByTime(1_100) })
    expect(result.current.size).toBe(0)
  })
})
