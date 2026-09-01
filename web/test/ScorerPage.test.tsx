import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { setMatBinding } from '@/lib/auth'
import { beep } from '@/lib/sounds'
import { fakeFetch, snapshotFeed, sampleMatch, sampleSnapshot } from './fakes'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

vi.mock('@/lib/sounds', () => ({ beep: vi.fn(), unlockAudio: vi.fn() }))
beforeEach(() => { localStorage.clear(); setMatBinding({ eventId: 1, matId: 1, matNumber: 1, eventName: 'Fall Duels', token: 'mat-tok' }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

// The scorer route is lazy-loaded, so mounting needs to flush until the chunk resolves.
// Fake timers (used by a couple of tests below) don't intercept promise microtasks, but they
// do intercept setTimeout, so the flush picks the timer-aware form.
async function flushOnce() {
  if (vi.isFakeTimers()) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  } else {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

async function mount() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/mat/1'] })} />)
  for (let i = 0; i < 50 && screen.queryByRole('status', { name: 'Loading' }); i++) await flushOnce()
  // Let the route's first automatic snapshot poll (initiated once the real component
  // mounts) settle before returning, so fake-timer tests can query synchronously afterward.
  for (let i = 0; i < 10; i++) await flushOnce()
}

describe('ScorerPage', () => {
  it('disables scoring until the stream connects, then posts a tap with the match seq', async () => {
    let resolveSnapshot!: (r: { json: unknown }) => void
    const pending = new Promise<{ json: unknown }>(resolve => { resolveSnapshot = resolve })
    let snapshotCalls = 0
    const f = fakeFetch(url => {
      if (url.includes('/snapshot')) return snapshotCalls++ === 0 ? pending : { json: { version: 1, now: sampleSnapshot().now } }
      return { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }
    })
    await mount()
    expect(await screen.findByText(/Reconnecting/)).toBeInTheDocument()
    resolveSnapshot({ json: { version: 1, snapshot: sampleSnapshot() } })
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    const takedown = within(left).getByRole('button', { name: /Takedown/ })
    expect(takedown).toBeEnabled()
    await userEvent.setup().click(takedown)
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/events')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/matches/10/events'))
    expect(body).toMatchObject({ type: 'score', athleteId: 100, actionKey: 'takedown', lastSeq: 0 })
    expect((f.calls.find(c => c.url === '/api/matches/10/events')!.init!.headers as Record<string, string>).authorization).toBe('Bearer mat-tok')
  })

  it('opens the confirm sheet after a terminal with the winner preselected and ends the match', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    const f = fakeFetch(url => feed.handle(url) ?? (url.endsWith('/end')
      ? { json: { match: sampleMatch({ status: 'done', result: { winnerAthleteId: 200, winType: 'submission' } }), version: 3 } }
      : { json: { match: sampleMatch({ lastSeq: 1, pendingTerminal: { athleteId: 200, actionKey: 'pin' } }), version: 2 } }))
    await mount()
    const user = userEvent.setup()
    const olivia = await screen.findByRole('region', { name: 'Olivia Kim' })
    await user.click(within(olivia).getByRole('button', { name: 'Pin' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Olivia Kim wins by submission/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 1 })
  })

  it('keeps the confirm sheet open when the undo behind Cancel fails', async () => {
    let undos = 0
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => {
      const fromFeed = feed.handle(url)
      if (fromFeed) return fromFeed
      if (url !== '/api/matches/10/events/last') {
        return { json: { match: sampleMatch({ lastSeq: 1, pendingTerminal: { athleteId: 200, actionKey: 'pin' } }), version: 2 } }
      }
      undos += 1
      if (undos === 1) return { status: 409, json: { error: { code: 'match_state', message: 'nothing to undo' } } }
      return { json: { match: sampleMatch({ lastSeq: 2 }), version: 4 } }
    })
    await mount()
    const user = userEvent.setup()
    const olivia = await screen.findByRole('region', { name: 'Olivia Kim' })
    await user.click(within(olivia).getByRole('button', { name: 'Pin' }))
    const sheet = await screen.findByRole('dialog')

    // The terminal is still pending on the server, so a failed undo has to leave the sheet up.
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('nothing to undo')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(undos).toBe(2)
  })

  it('asks for a decision on a tie and sends the picked winner', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    const f = fakeFetch(url => feed.handle(url) ?? { json: { match: sampleMatch({ status: 'done' }), version: 3 } })
    await mount()
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    await user.click(screen.getByRole('button', { name: 'End match' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await user.click(within(sheet).getByRole('button', { name: /Mateo Rivera/ }))
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 0, winnerAthleteId: 100 })
  })

  it('shows the empty state when the mat has no match', async () => {
    const feed = snapshotFeed(sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }], matches: [] }))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    expect(await screen.findByText(/No match on this mat/)).toBeInTheDocument()
  })

  it('beeps and opens the confirm sheet once the server confirms the clock has expired', async () => {
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    const feed = snapshotFeed(sampleSnapshot({ mats: [{ id: 1, number: 1, current: expired, onDeck: [], bound: true }], matches: [expired] }))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Time is up')
    expect(beep).toHaveBeenCalled()
  })

  it('keeps an in-progress End match tie pick when the clock expires under it', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'End match' }))
    let sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('End the match?')
    // Picking a winner on a tie swaps the sheet from the two toggles to a decided summary,
    // so once picked, "Mateo Rivera wins" is the signal the pick stuck (the toggle is gone).
    await user.click(within(sheet).getByRole('button', { name: /Mateo Rivera/ }))
    expect(within(sheet).getByText(/Mateo Rivera wins/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Confirm' })).toBeEnabled()

    // The clock reaches zero while the sheet from End match is still open and mid-pick.
    // Push the update and wait out one real poll interval -- the scorer's default snapshot
    // fixture has one idle mat, so the adaptive interval (pollInterval.ts) picks the
    // 3000ms live-idle rate, not a flat 1000ms. This test doesn't use fake timers, so
    // userEvent above stays on its normal real clock.
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    feed.push(sampleSnapshot({ mats: [{ id: 1, number: 1, current: expired, onDeck: [], bound: true }], matches: [expired] }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 3100)) })

    expect(beep).toHaveBeenCalled()
    sheet = screen.getByRole('dialog')
    expect(sheet).toHaveTextContent('End the match?')
    expect(within(sheet).getByText(/Mateo Rivera wins/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('does not auto-retry a 409 sequence conflict, and sends the corrected seq on the next tap', async () => {
    let scoreAttempts = 0
    const feed = snapshotFeed(sampleSnapshot())
    const f = fakeFetch(url => {
      const fromFeed = feed.handle(url)
      if (fromFeed) return fromFeed
      if (url !== '/api/matches/10/events') return { json: {} }
      scoreAttempts += 1
      if (scoreAttempts === 1) {
        return { status: 409, json: { error: { code: 'sequence', message: 'stale sequence', currentSeq: 7, match: sampleMatch({ lastSeq: 7 }) } } }
      }
      return { json: { match: sampleMatch({ lastSeq: 8 }), version: 5 } }
    })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    const takedown = within(left).getByRole('button', { name: /Takedown/ })
    const user = userEvent.setup()

    await user.click(takedown)
    await screen.findByRole('alert')
    expect(scoreAttempts).toBe(1)

    await user.click(takedown)
    await vi.waitFor(() => expect(scoreAttempts).toBe(2))
    const indices = f.calls.map((c, i) => (c.url === '/api/matches/10/events' ? i : -1)).filter(i => i >= 0)
    expect(indices).toHaveLength(2)
    expect(f.body(indices[1])).toMatchObject({ type: 'score', athleteId: 100, actionKey: 'takedown', lastSeq: 7 })
  })

  it('clears the expiry flash after its timeout', async () => {
    vi.useFakeTimers({ now: T0 })
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    const feed = snapshotFeed(sampleSnapshot({ mats: [{ id: 1, number: 1, current: expired, onDeck: [], bound: true }], matches: [expired] }))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    const center = screen.getByText('0:00').closest('div')!
    expect(center).toHaveClass('bg-warn/10')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(center).not.toHaveClass('bg-warn/10')
  })

  it('heartbeats at mount, again after 20 seconds, and stops after unmount', async () => {
    vi.useFakeTimers({ now: T0 })
    const f = fakeFetch(() => ({ json: {} }))
    await mount()
    const heartbeats = () => f.calls.filter(c => c.url === '/api/mats/1/heartbeat')
    expect(heartbeats()).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(heartbeats()).toHaveLength(2)
    cleanup()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(heartbeats()).toHaveLength(2)
  })
})
