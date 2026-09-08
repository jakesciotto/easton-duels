import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EXTEND_MAX_MS, EXTEND_MIN_MS, type Snapshot } from '@shared/types'
import { useScorer } from '@/routes/scorer/useScorer'
import { ADD_TIME_MS, WRITE_DEADLINE_MS } from '@/routes/scorer/actions'
import { loadLedger } from '@/routes/scorer/ledger'
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
    expect(result.current.sheet).toEqual({
      reason: 'end', winner: 100, winType: 'points', changed: null,
      // The scores travel with the winner they produced, so the sheet's restatement cannot
      // pair a frozen winner with a live score that contradicts it.
      shown: { winner: 100, winType: 'points', scores: { a: 2, b: 0 } },
    })
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
  //
  // The refusal is not enough on its own. Returning synchronously with the newly derived
  // winner already set left the affirmative enabled, in place and immediately valid, so
  // the SECOND press of a double tap recorded the competitor the operator never picked --
  // the same silent wrong winner the refusal exists to stop.
  it('will not let the second press of a double tap record the winner the refusal just derived', async () => {
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
    // No affirmative to press: the sheet holds no winner, and it says what moved.
    expect(result.current.sheet).toMatchObject({
      winner: null,
      winType: null,
      shown: { winner: 200, winType: 'points', scores: { a: 0, b: 3 } },
      changed: {
        was: { winner: null, winType: null, scores: { a: 0, b: 0 } },
        now: { winner: 200, winType: 'points', scores: { a: 0, b: 3 } },
      },
    })

    // The second half of the double tap. It must not record anything.
    await act(async () => { await result.current.confirm() })
    expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(false)
    expect(result.current.sheet).not.toBeNull()

    // Only a new decision naming the new winner clears it, and then the record goes through.
    act(() => result.current.pickWinner(200))
    expect(result.current.sheet).toMatchObject({ winner: 200, winType: 'points', changed: null })
    await act(async () => { await result.current.confirm() })
    await settle(result)
    const end = f.calls.findIndex(c => c.url === '/api/matches/10/end')
    expect(end).toBeGreaterThanOrEqual(0)
    expect(f.body(end)).not.toHaveProperty('winnerAthleteId')
    expect(result.current.sheet).toBeNull()
  })

  // The write chain serialises, it does not deduplicate. A terminal ends the match and the
  // half only disables once the pending terminal comes back on a response, so a double tap
  // had the whole round trip to send a SECOND terminal: the server wrote both, one "Back to
  // match" removed only the newer, and the mat was left refused with a terminal standing.
  it('sends one terminal for a double tap, not two', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const f = fakeFetch(async url => {
      if (url !== '/api/matches/10/events') return { json: { ok: true } }
      await held
      return { json: { match: sampleMatch({ lastSeq: 1, pendingTerminal: { athleteId: 100, actionKey: 'submission' } }), version: 2 } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => {
      void result.current.terminal(100, 'submission')
      void result.current.terminal(100, 'submission')
    })
    release()
    await settle(result)

    expect(f.calls.filter(c => c.url === '/api/matches/10/events')).toHaveLength(1)
    expect(result.current.sheet).toMatchObject({ reason: 'terminal', winner: 100, winType: 'submission' })

    // The guard releases with the write, so a terminal for the other competitor after a
    // "Back to match" is not locked out for the rest of the match.
    await act(async () => { await result.current.terminal(200, 'submission') })
    expect(f.calls.filter(c => c.url === '/api/matches/10/events')).toHaveLength(2)
  })

  // The sheet is where a refused confirm is printed, so the error has to leave with it.
  // Left set, it reappeared in the centre column the moment the match ended successfully.
  it('clears the refusal error when the sheet closes', async () => {
    let ends = 0
    const f = fakeFetch(url => {
      if (!url.endsWith('/end')) return { json: { ok: true } }
      ends += 1
      if (ends === 1) return { status: 409, json: { error: { code: 'match_state', message: 'match is done' } } }
      return { json: { match: sampleMatch({ status: 'done' }), version: 4 } }
    })
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.openEnd())
    act(() => result.current.pickWinner(100))
    await act(async () => { await result.current.confirm() })
    await settle(result)
    expect(result.current.error).toMatch(/Reopen it from the Live tab/)
    expect(result.current.sheet).not.toBeNull()

    await act(async () => { await result.current.confirm() })
    await settle(result)
    expect(result.current.sheet).toBeNull()
    expect(result.current.error).toBeNull()
    expect(f.calls.filter(c => c.url === '/api/matches/10/end')).toHaveLength(2)
  })

  it('clears the refusal error when the operator goes back to the match', async () => {
    fakeFetch(url => (url.endsWith('/end')
      ? { status: 409, json: { error: { code: 'match_state', message: 'match is done' } } }
      : { json: { ok: true } }))
    const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

    act(() => result.current.openEnd())
    act(() => result.current.pickWinner(100))
    await act(async () => { await result.current.confirm() })
    await settle(result)
    expect(result.current.error).not.toBeNull()

    await act(async () => { await result.current.cancel() })
    expect(result.current.sheet).toBeNull()
    expect(result.current.error).toBeNull()
  })

  /**
   * G04. A token lives 24 hours and a takeover kills the one it replaced, so both of these
   * reach a tablet that is otherwise working: it shows a live match, it takes taps, and
   * every one of them fails. The 401 is a fact about the binding, not about the write, so
   * it is reported as one and the page acts on it.
   */
  describe('when the tablet loses its mat', () => {
    const unauthorized = { status: 401, json: { error: { code: 'unauthorized', message: 'token required' } } }
    const stale = {
      status: 401,
      json: { error: { code: 'token_stale', message: 'Another iPad took this mat over. Bind again to score from here.' } },
    }

    it('reports an expired token from a write rather than printing the server word for it', async () => {
      fakeFetch(url => (url === '/api/matches/10/events' ? unauthorized : { json: { ok: true } }))
      const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

      act(() => result.current.tap(100, 'takedown'))
      await settle(result)
      expect(result.current.bindingLost).toBe('expired')
      // Not an inline write error: there is nothing on this screen for the operator to
      // retry, and the page is about to leave.
      expect(result.current.error).toBeNull()
    })

    it('reports a takeover from a write', async () => {
      fakeFetch(url => (url === '/api/matches/10/events' ? stale : { json: { ok: true } }))
      const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

      act(() => result.current.tap(100, 'takedown'))
      await settle(result)
      expect(result.current.bindingLost).toBe('taken')
    })

    // The heartbeat is the only thing this tablet sends while nobody is scoring, so it is
    // what finds a lost binding between matches. It swallowed every failure.
    it('reports both from the heartbeat, with nobody touching the screen', async () => {
      for (const [reply, expected] of [[unauthorized, 'expired'], [stale, 'taken']] as const) {
        fakeFetch(() => reply)
        const { result, unmount } = renderHook(() => useScorer(binding, sampleSnapshot(), true))
        await vi.waitFor(() => expect(result.current.bindingLost).toBe(expected))
        unmount()
      }
    })

    // A 403 is a token for another mat, which is a different fault with a different cure,
    // and a 409 is the match talking. Neither unbinds the device.
    it('leaves the binding alone for anything that is not a 401 about this token', async () => {
      fakeFetch(url => (url === '/api/matches/10/events'
        ? { status: 403, json: { error: { code: 'forbidden', message: 'token is for another mat' } } }
        : { json: { ok: true } }))
      const { result } = renderHook(() => useScorer(binding, sampleSnapshot(), true))

      act(() => result.current.tap(100, 'takedown'))
      await settle(result)
      expect(result.current.bindingLost).toBeNull()
      expect(result.current.error).toMatch(/another mat/)
    })
  })

  /**
   * G11. The ledger lived in component state, so a tablet that reloaded mid match refused
   * to take back the tap it had just made: Undo and both minus buttons printed "The newest
   * action came from elsewhere", which was not true, and the mat had no correction left.
   */
  describe('the ledger across a reload', () => {
    beforeEach(() => sessionStorage.clear())

    const scored = sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } })

    it('restores what this tablet recorded, so undo still names its target', async () => {
      const f = fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
      const first = renderHook(() => useScorer(binding, sampleSnapshot(), true))
      act(() => first.result.current.tap(100, 'takedown'))
      await settle(first.result)
      expect(first.result.current.lastAction).toMatchObject({ kind: 'score', name: 'Mateo Rivera', points: 2 })
      first.unmount()

      // The tablet is reloaded. All it has is the snapshot, which carries the score but
      // says nothing about who put it there.
      const after = renderHook(() => useScorer(binding, snapshotWith(scored, 2), true))
      expect(after.result.current.lastAction).toMatchObject({ kind: 'score', name: 'Mateo Rivera', points: 2 })

      act(() => after.result.current.minus(100))
      await settle(after.result)
      expect(f.calls.some(c => c.url === '/api/matches/10/events/last')).toBe(true)
    })

    // Anything above the seq the server reports describes an event that was taken away
    // while this tab was gone, and offering to undo it would take back somebody else's.
    it('drops entries the server no longer reports', async () => {
      fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
      const first = renderHook(() => useScorer(binding, sampleSnapshot(), true))
      act(() => first.result.current.tap(100, 'takedown'))
      await settle(first.result)
      first.unmount()

      // The desk undid it before the tablet came back.
      const after = renderHook(() => useScorer(binding, snapshotWith(sampleMatch({ lastSeq: 0 }), 3), true))
      expect(after.result.current.lastAction).toBeNull()
    })

    it('keeps the ledger of one match out of the next one', async () => {
      fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
      const first = renderHook(() => useScorer(binding, sampleSnapshot(), true))
      act(() => first.result.current.tap(100, 'takedown'))
      await settle(first.result)
      first.unmount()

      const next = sampleMatch({ id: 11, orderIndex: 1, lastSeq: 1 })
      const after = renderHook(() => useScorer(binding, snapshotWith(next, 4), true))
      expect(after.result.current.lastAction).toBeNull()
    })

    /**
     * M14. Keys were written and never removed, so one tablet holding one mat accumulated a
     * ledger for every bout it had scored, none of them readable by any control again.
     */
    it('removes the key of the match it has left behind', async () => {
      fakeFetch(url => (url === '/api/matches/10/events' ? { json: { match: scored, version: 2 } } : { json: { ok: true } }))
      const view = renderHook(({ snap }: { snap: Snapshot }) => useScorer(binding, snap, true), { initialProps: { snap: sampleSnapshot() } })
      act(() => view.result.current.tap(100, 'takedown'))
      await settle(view.result)
      expect(loadLedger(10, 9)).toHaveLength(1)

      view.rerender({ snap: snapshotWith(sampleMatch({ id: 11, orderIndex: 1 }), 4) })
      expect(loadLedger(10, 9)).toEqual([])
    })
  })

  /**
   * G19. The clock is the one thing a referee cannot correct after the fact, so a match
   * that ran out takes another minute rather than a result nobody agrees with.
   */
  describe('adding time', () => {
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    const longer = sampleMatch({ lastSeq: 1, lengthSec: 360, clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 360_000 } })

    it('paints the new length at once and posts a minute inside the server bounds', async () => {
      const f = fakeFetch(url => (url.includes('/clock/extend') ? { json: { match: longer, version: 2 } } : { json: { ok: true } }))
      const { result } = renderHook(() => useScorer(binding, snapshotWith(expired), true))

      act(() => result.current.addTime())
      expect(result.current.current?.clock.lengthMs).toBe(360_000)
      expect(result.current.current?.lengthSec).toBe(360)
      await settle(result)
      const body = f.body(f.calls.findIndex(c => c.url.includes('/clock/extend')))
      expect(body.addMs).toBe(ADD_TIME_MS)
      expect(body.addMs).toBeGreaterThanOrEqual(EXTEND_MIN_MS)
      expect(body.addMs).toBeLessThanOrEqual(EXTEND_MAX_MS)
    })

    it('adds another minute on every press', async () => {
      let served = expired
      const f = fakeFetch(url => {
        if (!url.includes('/clock/extend')) return { json: { ok: true } }
        served = { ...served, lastSeq: served.lastSeq + 1, lengthSec: served.lengthSec + 60, clock: { ...served.clock, lengthMs: served.clock.lengthMs + 60_000 } }
        return { json: { match: served, version: served.lastSeq + 1 } }
      })
      const { result } = renderHook(() => useScorer(binding, snapshotWith(expired), true))

      act(() => result.current.addTime())
      await settle(result)
      act(() => result.current.addTime())
      await settle(result)
      expect(f.calls.filter(c => c.url.includes('/clock/extend'))).toHaveLength(2)
      expect(result.current.current?.clock.lengthMs).toBe(420_000)
    })

    it('will not send one while the clock is running', async () => {
      const running = sampleMatch({ clock: { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 } })
      const f = fakeFetch(() => ({ json: { ok: true } }))
      const { result } = renderHook(() => useScorer(binding, snapshotWith(running), true))

      act(() => result.current.addTime())
      expect(f.calls.some(c => c.url.includes('/clock/extend'))).toBe(false)
    })

    /**
     * M8. The retry adopts the server's seq, but the ledger entry was written before the
     * request and kept the number the tablet had guessed. An entry whose seq is not the
     * match's lastSeq is not `lastAction` at all, so Undo refused with "The newest action
     * came from elsewhere" for the minute the operator had just added, and went on refusing
     * until the next write.
     */
    it('takes the server seq into the ledger when the retry adopts it', async () => {
      let attempts = 0
      const swept = sampleMatch({ lastSeq: 5, lengthSec: 360, clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 360_000 } })
      const f = fakeFetch(url => {
        if (url.endsWith('/events/last')) return { json: { match: expired, version: 4 } }
        if (!url.includes('/clock/extend')) return { json: { ok: true } }
        attempts += 1
        if (attempts === 1) return { status: 409, json: { error: { code: 'sequence', message: 'stale sequence', currentSeq: 4 } } }
        return { json: { match: swept, version: 3 } }
      })
      const { result } = renderHook(() => useScorer(binding, snapshotWith(expired), true))

      act(() => result.current.addTime())
      await settle(result)
      expect(result.current.current?.lastSeq).toBe(5)
      expect(result.current.lastAction).toMatchObject({ kind: 'extend', seq: 5 })

      // And the control that reads it answers, which is the whole point of the entry.
      act(() => result.current.undo())
      await settle(result)
      expect(f.calls.some(c => c.url === '/api/matches/10/events/last')).toBe(true)
    })

    // Undo removes the newest event whatever it is, so an extension the operator did not
    // mean comes straight back off, length and all.
    it('lets undo take the added minute back', async () => {
      const f = fakeFetch(url => {
        if (url.includes('/clock/extend')) return { json: { match: longer, version: 2 } }
        if (url.endsWith('/events/last')) return { json: { match: expired, version: 3 } }
        return { json: { ok: true } }
      })
      const { result } = renderHook(() => useScorer(binding, snapshotWith(expired), true))

      act(() => result.current.addTime())
      await settle(result)
      expect(result.current.lastAction).toMatchObject({ kind: 'extend', addMs: ADD_TIME_MS })

      act(() => result.current.undo())
      expect(result.current.current?.clock.lengthMs).toBe(300_000)
      await settle(result)
      expect(f.calls.some(c => c.url === '/api/matches/10/events/last')).toBe(true)
    })
  })
})
