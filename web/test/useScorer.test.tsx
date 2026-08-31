import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Snapshot } from '@shared/types'
import { useScorer } from '@/routes/scorer/useScorer'
import type { MatBinding } from '@/lib/auth'
import { fakeFetch, sampleMatch, sampleSnapshot } from './fakes'

const binding: MatBinding = { eventId: 1, matId: 1, matNumber: 1, eventName: 'Fall Duels', token: 'mat-tok' }

afterEach(() => vi.unstubAllGlobals())

function snapshotWith(current: ReturnType<typeof sampleMatch>, version = 1): Snapshot {
  return sampleSnapshot({ version, mats: [{ id: 1, number: 1, current, onDeck: [], bound: true }], matches: [current] })
}

describe('useScorer', () => {
  it('reads its own write response while the poll is still an interval behind', async () => {
    const running = sampleMatch({ lastSeq: 1, clock: { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 } })
    const f = fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: running, version: 2 } } : { json: { ok: true } }))
    const stale = sampleSnapshot()
    const { result, rerender } = renderHook(({ snap }) => useScorer(binding, snap, true), { initialProps: { snap: stale } })

    await act(async () => { await result.current.clock() })
    const scoringCalls = () => f.calls.map((c, i) => (c.url === '/api/matches/10/events' ? i : -1)).filter(i => i >= 0)
    expect(f.body(scoringCalls()[0])).toMatchObject({ type: 'clock_start', lastSeq: 0 })

    // The next poll still carries the pre-write match, so the direction of the clock button
    // has to come from the write response or the server answers 409 clock already running.
    rerender({ snap: stale })
    await act(async () => { await result.current.clock() })
    expect(f.body(scoringCalls()[1])).toMatchObject({ type: 'clock_pause', lastSeq: 1 })
  })

  it('derives the end sheet from its own write, not the stale snapshot', async () => {
    const base = sampleMatch()
    const scored = sampleMatch({ lastSeq: 1, a: { ...base.a, score: 2 } })
    fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    await act(async () => { await result.current.tap(100, 'takedown') })
    act(() => result.current.openEnd())
    expect(result.current.sheet).toEqual({ reason: 'end', winner: 100, winType: 'points' })
  })

  it("hands authority to a newer-version poll even when its seq is lower, as with another device's undo", async () => {
    const scored = sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } })
    fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    await act(async () => { await result.current.tap(100, 'takedown') })
    expect(result.current.current?.a.score).toBe(2)

    // Another device undoes the tap: the poll's seq goes DOWN (below this scorer's own
    // write), but its version is newer, so it must still win the handoff.
    const undone = sampleMatch({ lastSeq: 0 })
    rerender({ snap: snapshotWith(undone, 3) })
    expect(result.current.current?.a.score).toBe(0)
    expect(result.current.current?.lastSeq).toBe(0)
  })

  it('ignores a poll whose version has not caught up to its own write, even if stale', async () => {
    const scored = sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } })
    fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    await act(async () => { await result.current.tap(100, 'takedown') })
    expect(result.current.current?.a.score).toBe(2)

    // A poll still at the pre-write version is stale and must not override the pinned write.
    const stalePoll = sampleMatch({ lastSeq: 1 })
    rerender({ snap: snapshotWith(stalePoll, 1) })
    expect(result.current.current?.a.score).toBe(2)
  })
})
