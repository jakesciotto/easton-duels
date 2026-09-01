import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Snapshot } from '@shared/types'
import { useScorer } from '@/routes/scorer/useScorer'
import { WRITE_DEADLINE_MS } from '@/routes/scorer/actions'
import type { MatBinding } from '@/lib/auth'
import { fakeFetch, sampleMatch, sampleSnapshot } from './fakes'

vi.mock('@/lib/sounds', () => ({
  playRegistered: vi.fn(), playExpired: vi.fn(), playRejected: vi.fn(), unlockAudio: vi.fn(),
}))

const binding: MatBinding = { eventId: 1, matId: 1, matNumber: 1, eventName: 'Fall Duels', token: 'mat-tok' }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function snapshotWith(current: ReturnType<typeof sampleMatch>, version = 1): Snapshot {
  return sampleSnapshot({ version, mats: [{ id: 1, number: 1, current, onDeck: [], bound: true }], matches: [current] })
}

// Every write is queued, so "the write landed" is "the queue drained", not "the call returned".
async function settle(result: { current: { busy: boolean } }) {
  await vi.waitFor(() => expect(result.current.busy).toBe(false))
}

describe('useScorer', () => {
  it('reads its own write response while the poll is still an interval behind', async () => {
    const running = sampleMatch({ lastSeq: 1, clock: { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 } })
    const f = fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: running, version: 2 } } : { json: { ok: true } }))
    const stale = sampleSnapshot()
    const { result, rerender } = renderHook(({ snap }) => useScorer(binding, snap, true), { initialProps: { snap: stale } })

    act(() => result.current.clock())
    await settle(result)
    const scoringCalls = () => f.calls.map((c, i) => (c.url === '/api/matches/10/events' ? i : -1)).filter(i => i >= 0)
    expect(f.body(scoringCalls()[0])).toMatchObject({ type: 'clock_start', lastSeq: 0 })

    // The next poll still carries the pre-write match, so the direction of the clock button
    // has to come from the write response or the server answers 409 clock already running.
    rerender({ snap: stale })
    act(() => result.current.clock())
    await settle(result)
    expect(f.body(scoringCalls()[1])).toMatchObject({ type: 'clock_pause', lastSeq: 1 })
  })

  it('derives the end sheet from its own write, not the stale snapshot', async () => {
    const base = sampleMatch()
    const scored = sampleMatch({ lastSeq: 1, a: { ...base.a, score: 2 } })
    fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    act(() => result.current.openEnd())
    expect(result.current.sheet).toEqual({ reason: 'end', winner: 100, winType: 'points', shown: { winner: 100, winType: 'points' } })
  })

  it("hands authority to a newer-version poll even when its seq is lower, as with another device's undo", async () => {
    const scored = sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } })
    const bodies: number[] = []
    const f = fakeFetch((url, init) => {
      if (url !== '/api/matches/10/events') return { json: { ok: true } }
      bodies.push(JSON.parse(String(init?.body)).lastSeq)
      return { json: { match: scored, version: 2 } }
    })
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(result.current.current?.a.score).toBe(2)

    // Another device undoes the tap: the poll's seq goes DOWN (below this scorer's own
    // write), but its version is newer, so it must still win the handoff.
    const undone = sampleMatch({ lastSeq: 0 })
    rerender({ snap: snapshotWith(undone, 3) })
    expect(result.current.current?.a.score).toBe(0)
    expect(result.current.current?.lastSeq).toBe(0)

    // And the seq the NEXT write carries has to come down with it. A seq that only ever
    // climbed left this tablet one guaranteed 409 behind every remote undo.
    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(bodies).toEqual([0, 0])
    expect(f.calls.filter(c => c.url === '/api/matches/10/events')).toHaveLength(2)
  })

  // A refused write leaves the server where it was, so the ledger entry that described it
  // describes nothing. Left in place, it becomes `lastAction` again the moment any other
  // device's write reaches its number, and the tablet then names an event that never
  // happened and offers to subtract its points from the wrong side.
  it('forgets what it recorded for a write the server refused', async () => {
    fakeFetch(url => (url === '/api/matches/10/events'
      ? { status: 429, json: { error: { code: 'rate_limited', message: 'slow down' } } }
      : { json: { ok: true } }))
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(result.current.current?.a.score).toBe(0)
    expect(result.current.lastAction).toBeNull()

    // The desk now scores for the OTHER competitor, and the match seq reaches the number
    // the refused tap had claimed.
    rerender({ snap: snapshotWith(sampleMatch({ lastSeq: 1, b: { ...sampleMatch().b, score: 3 } }), 2) })
    expect(result.current.current?.b.score).toBe(3)
    expect(result.current.lastAction).toBeNull()
  })

  // Nothing in the write path bounds a socket the room's access point dropped without a
  // reset: the serial chain parks on it, every later tap paints and queues behind it, and
  // the confirm sheet's own buttons stay disabled with the modal covering the screen.
  it('gives up on a write that never answers instead of parking the mat on it', async () => {
    vi.useFakeTimers()
    fakeFetch(url => (url === '/api/matches/10/events' ? new Promise<never>(() => {}) : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    expect(result.current.current?.a.score).toBe(2)
    expect(result.current.busy).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS + 100) })
    expect(result.current.busy).toBe(false)
    expect(result.current.current?.a.score).toBe(0)
    expect(result.current.error).toMatch(/No answer from the server/)
    // The sheet is dismissible throughout: it is gated on its own write, never the queue.
    expect(result.current.sheetBusy).toBe(false)
  })

  // The server's undo removes the newest event and nothing else. It refuses to remove a
  // pause, and removing a start stops a clock nobody asked it to stop, so a tablet whose
  // own clock press is the newest event has to say that rather than offer a generic Undo.
  it('records its own clock presses and will not undo one', async () => {
    const started = sampleMatch({ lastSeq: 1, clock: { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 } })
    const f = fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: started, version: 2 } } : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.clock())
    await settle(result)
    expect(result.current.lastAction).toMatchObject({ kind: 'clock', label: 'Clock started', seq: 1 })

    act(() => result.current.undo())
    await settle(result)
    expect(f.calls.some(c => c.url === '/api/matches/10/events/last')).toBe(false)
    expect(result.current.current?.clock.startedAt).not.toBeNull()
  })

  it('ignores a poll whose version has not caught up to its own write, even if stale', async () => {
    const scored = sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } })
    fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(result.current.current?.a.score).toBe(2)

    // A poll still at the pre-write version is stale and must not override the pinned write.
    const stalePoll = sampleMatch({ lastSeq: 1 })
    rerender({ snap: snapshotWith(stalePoll, 1) })
    expect(result.current.current?.a.score).toBe(2)
  })

  // 4.1: a scorer cannot wait for a round trip with a referee signalling.
  it('paints a tap before the server answers and reconciles onto the response', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    fakeFetch(async url => {
      if (url !== '/api/matches/10/events') return { json: { ok: true } }
      await held
      return { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    expect(result.current.current?.a.score).toBe(2)
    expect(result.current.current?.lastSeq).toBe(1)

    release()
    await settle(result)
    expect(result.current.current?.a.score).toBe(2)
  })

  it('stacks a second tap on the first instead of blocking it, and sends them in order', async () => {
    const scores: number[] = []
    let seen = 0
    fakeFetch((url, init) => {
      if (url !== '/api/matches/10/events') return { json: { ok: true } }
      scores.push(JSON.parse(String(init?.body)).lastSeq)
      seen += 1
      const a = { ...sampleMatch().a, score: seen * 2 }
      return { json: { match: sampleMatch({ lastSeq: seen, a }), version: 1 + seen } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => {
      result.current.tap(100, 'takedown')
      result.current.tap(100, 'takedown')
    })
    expect(result.current.current?.a.score).toBe(4)

    await settle(result)
    expect(scores).toEqual([0, 1])
    expect(result.current.current?.a.score).toBe(4)
  })

  it('rolls the optimistic score back and says why when the write is refused', async () => {
    fakeFetch(url => (url === '/api/matches/10/events'
      ? { status: 409, json: { error: { code: 'match_state', message: 'match is done' } } }
      : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    expect(result.current.current?.a.score).toBe(2)

    await settle(result)
    expect(result.current.current?.a.score).toBe(0)
    expect(result.current.error).toMatch(/Reopen it from the Live tab/)
  })

  it('drops the writes queued behind a failure instead of sending them against a state that never happened', async () => {
    const sent: string[] = []
    fakeFetch((url, init) => {
      if (url !== '/api/matches/10/events') return { json: { ok: true } }
      sent.push(JSON.parse(String(init?.body)).type)
      return { status: 409, json: { error: { code: 'match_state', message: 'match is done' } } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => {
      result.current.tap(100, 'takedown')
      result.current.tap(100, 'takedown')
    })
    await settle(result)
    expect(sent).toEqual(['score'])
    expect(result.current.current?.a.score).toBe(0)
  })

  // An undo lowers the match seq, so keeping the higher seq that was just sent made the
  // next tap a guaranteed conflict.
  it('sends the decremented seq on the tap after an undo', async () => {
    const bodies: { url: string; lastSeq: number }[] = []
    fakeFetch((url, init) => {
      if (!url.startsWith('/api/matches/10')) return { json: { ok: true } }
      bodies.push({ url, lastSeq: JSON.parse(String(init?.body)).lastSeq })
      if (url.endsWith('/events/last')) return { json: { match: sampleMatch({ lastSeq: 0 }), version: 3 } }
      return { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    act(() => result.current.undo())
    await settle(result)
    act(() => result.current.tap(100, 'takedown'))
    await settle(result)

    expect(bodies.map(b => b.lastSeq)).toEqual([0, 1, 0])
  })

  // 6.16: undo has to be able to name what it removes, and the per side minus is gated on
  // the same knowledge.
  it('remembers what this tablet recorded, with the clock reading at the tap', async () => {
    const running = sampleMatch({ clock: { elapsedMs: 166_000, startedAt: null, lengthMs: 300_000 } })
    fakeFetch(url => (url === '/api/matches/10/events'
      ? { json: { match: { ...running, lastSeq: 1, a: { ...running.a, score: 2 } }, version: 2 } }
      : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, snapshotWith(running), true))

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(result.current.lastAction).toMatchObject({ athleteId: 100, name: 'Mateo Rivera', label: 'Takedown', points: 2, at: '2:14' })
  })

  it('forgets the local ledger once the newest event is no longer the one it recorded', async () => {
    fakeFetch(url => (url === '/api/matches/10/events'
      ? { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }
      : { json: { ok: true } }))
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(result.current.lastAction).not.toBeNull()

    // Another device scores: the newest event is no longer ours, so nothing here may name it.
    rerender({ snap: snapshotWith(sampleMatch({ lastSeq: 2, b: { ...sampleMatch().b, score: 2 } }), 4) })
    expect(result.current.lastAction).toBeNull()
  })

  it('takes the newest action back for its own side and refuses to do it for the other one', async () => {
    let undos = 0
    fakeFetch(url => {
      if (url === '/api/matches/10/events/last') {
        undos += 1
        return { json: { match: sampleMatch({ lastSeq: 0 }), version: 3 } }
      }
      if (url === '/api/matches/10/events') return { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }
      return { json: { ok: true } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)

    act(() => result.current.minus(200))
    await settle(result)
    expect(undos).toBe(0)

    act(() => result.current.minus(100))
    await settle(result)
    expect(undos).toBe(1)
    expect(result.current.current?.a.score).toBe(0)
  })

  it('does not auto-retry a 409 sequence conflict, and sends the corrected seq on the next tap', async () => {
    let attempts = 0
    const bodies: number[] = []
    fakeFetch((url, init) => {
      if (url !== '/api/matches/10/events') return { json: { ok: true } }
      attempts += 1
      bodies.push(JSON.parse(String(init?.body)).lastSeq)
      if (attempts === 1) return { status: 409, json: { error: { code: 'sequence', message: 'stale sequence', currentSeq: 7 } } }
      return { json: { match: sampleMatch({ lastSeq: 8 }), version: 5 } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(attempts).toBe(1)
    expect(result.current.error).toMatch(/Another device scored this mat first/)

    act(() => result.current.tap(100, 'takedown'))
    await settle(result)
    expect(bodies).toEqual([0, 7])
  })

  // The scorer cannot suspend its poll under an open sheet the way 4.4 does elsewhere,
  // because an expiry under that sheet still has to sound. So the sheet checks that the
  // match still says what it said when it was raised: the server derives the winner from
  // its own events and IGNORES winnerAthleteId once a tie is broken, so a decision picked
  // against a score that has since moved would record the other competitor in silence.
  it('will not record a decision the score stopped supporting while the sheet was open', async () => {
    const f = fakeFetch(url => (url.endsWith('/end')
      ? { json: { match: sampleMatch({ status: 'done' }), version: 4 } }
      : { json: { ok: true } }))
    const { result, rerender } = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot({ version: 1 }) } })

    act(() => result.current.openEnd())
    act(() => result.current.pickWinner(100))
    expect(result.current.sheet).toMatchObject({ winner: 100, winType: 'decision' })

    // The desk records a sweep for the other competitor while the operator is picking.
    rerender({ snap: snapshotWith(sampleMatch({ lastSeq: 1, b: { ...sampleMatch().b, score: 3 } }), 2) })
    await act(async () => { await result.current.confirm() })

    expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(false)
    expect(result.current.error).toMatch(/score changed/)
    expect(result.current.sheet).toMatchObject({ winner: 200, winType: 'points' })

    // The restated sheet is what the second press answers, and that one goes through.
    await act(async () => { await result.current.confirm() })
    await settle(result)
    const end = f.calls.findIndex(c => c.url === '/api/matches/10/end')
    expect(end).toBeGreaterThanOrEqual(0)
    expect(f.body(end)).not.toHaveProperty('winnerAthleteId')
    expect(result.current.sheet).toBeNull()
  })
})
