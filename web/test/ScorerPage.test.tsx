import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { SHORTEST_VIEWPORT } from '@/routes/scorer/budget'
import { CenterColumn } from '@/routes/scorer/CenterColumn'
import { ConfirmSheet } from '@/routes/scorer/ConfirmSheet'
import type { Sheet as SheetState } from '@/routes/scorer/useScorer'
import { setMatBinding } from '@/lib/auth'
import { playExpired, playRejected } from '@/lib/sounds'
import { fakeFetch, snapshotFeed, sampleMatch, sampleSnapshot } from './fakes'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

vi.mock('@/lib/sounds', () => ({
  playRegistered: vi.fn(), playExpired: vi.fn(), playRejected: vi.fn(), unlockAudio: vi.fn(),
}))
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

const expiredMatch = () => sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
const onOneMat = (match: ReturnType<typeof sampleMatch>) =>
  sampleSnapshot({ mats: [{ id: 1, number: 1, current: match, onDeck: [], bound: true }], matches: [match] })

// jsdom computes no layout, so what can be proved here is STRUCTURE: which elements sit
// inside the one region that is allowed to scroll. The budget suite proves the arithmetic.
function centreColumn() {
  return screen.getByRole('button', { name: 'End match' }).closest('.w-80') as HTMLElement
}
function referenceRegion() {
  const found = centreColumn().querySelector('.overflow-y-auto')
  expect(found, 'the centre column has exactly one scroller').not.toBeNull()
  return found as HTMLElement
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
    await user.click(within(olivia).getByRole('button', { name: 'Pin for Olivia Kim' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Olivia Kim wins by submission/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Record win by submission' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 1 })
  })

  it('keeps the confirm sheet open when the undo behind Back to match fails', async () => {
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
    await user.click(within(olivia).getByRole('button', { name: 'Pin for Olivia Kim' }))
    const sheet = await screen.findByRole('dialog')

    // The terminal is still pending on the server, so a failed undo has to leave the sheet up.
    await user.click(within(sheet).getByRole('button', { name: 'Back to match' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('nothing to undo')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Back to match' }))
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
    const record = within(sheet).getByRole('button', { name: /^Record win/ })
    expect(record).toBeDisabled()
    // 6.16: there is no default affirmative, so opening the sheet arms nothing.
    expect(document.activeElement).not.toBe(record)
    await user.click(within(sheet).getByRole('button', { name: 'Mateo Rivera wins' }))
    await user.click(within(sheet).getByRole('button', { name: 'Record win by decision' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 0, winnerAthleteId: 100 })
  })

  it('shows the empty state when the mat has no match', async () => {
    const feed = snapshotFeed(sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }], matches: [] }))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    expect(await screen.findByText(/No match on this mat/)).toBeInTheDocument()
  })

  // 6.16: the action grid is fixed 3 x 3 and a shorter ruleset leaves cells EMPTY rather
  // than re-laying out, because a thumb learns a position and the position must not depend
  // on how many actions the organizer typed.
  it('holds nine action cells whatever the ruleset carries', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    const grid = within(left).getByRole('button', { name: /Takedown/ }).parentElement!
    expect(grid.childElementCount).toBe(9)
    expect(within(left).getAllByRole('button', { name: /Takedown|Mount|Penalty/ })).toHaveLength(3)
  })

  // 6.16, the moat: a terminal never shares a row with a point button, so it is not in
  // the grid at all.
  it('keeps the terminals out of the action grid', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    const grid = within(left).getByRole('button', { name: /Takedown/ }).parentElement!
    expect(within(grid).queryByRole('button', { name: /Submission/ })).toBeNull()
    expect(within(left).getByRole('button', { name: 'Submission for Mateo Rivera' })).toBeEnabled()
  })

  // Both halves carry the same ruleset, so the visible label alone leaves a rotor, a screen
  // reader and Voice Control two identical "Takedown +2" targets and two identical
  // "Submission" ones, and a terminal picked at random ends the match for the wrong
  // competitor. The section landmark does not reach a list of buttons.
  it('gives every point and terminal button an accessible name that says whose it is', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    for (const label of [/Takedown/, /Mount/, /Penalty/, /Submission/, /Pin/]) {
      const names = screen.getAllByRole('button', { name: label }).map(b => b.getAttribute('aria-label'))
      expect(names, String(label)).toHaveLength(2)
      expect(names.filter(n => n?.includes('Mateo Rivera')), String(label)).toHaveLength(1)
      expect(names.filter(n => n?.includes('Olivia Kim')), String(label)).toHaveLength(1)
    }
  })

  // 4.1: a scorer cannot wait for a round trip with a referee signalling.
  it('paints a tap on the score before the server answers', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(async url => {
      const fromFeed = feed.handle(url)
      if (fromFeed) return fromFeed
      if (url !== '/api/matches/10/events') return { json: {} }
      await held
      return { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }
    })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    expect(within(left).getByText('0')).toBeInTheDocument()
    await userEvent.setup().click(within(left).getByRole('button', { name: /Takedown/ }))
    expect(within(left).getByText('2')).toBeInTheDocument()
    release()
  })

  // 4.1: on a non-2xx, revert to the last snapshot value, fire the rejected tone and print
  // the mapped copy inline. Never a toast, never a silent revert.
  it('rolls a refused tap back and prints why it was refused', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { status: 409, json: { error: { code: 'match_state', message: 'match is done' } } })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    await userEvent.setup().click(within(left).getByRole('button', { name: /Takedown/ }))
    expect(await screen.findByText(/Reopen it from the Live tab/)).toBeInTheDocument()
    expect(within(left).getByText('0')).toBeInTheDocument()
    expect(playRejected).toHaveBeenCalled()
  })

  // 6.16: score taps stay enabled while the clock is paused, because referees stop the
  // clock to award points.
  it('keeps the point buttons live while the clock is paused', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(within(left).getByRole('button', { name: /Takedown/ })).toBeEnabled()
  })

  // 6.16, refuse rather than reject.
  it('disables a control the state machine would turn down and prints the reason', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled()
    // Undo and the two minus buttons are one correction and refuse together, so the reason
    // prints once under the group rather than twice under two halves of it.
    expect(screen.getAllByText('Nothing to take back yet.')).toHaveLength(1)
  })

  // 6.16: undo names its target, beside a persistent last action line, so the scorer and
  // the coach beside them can reconcile against the referee without touching anything.
  it('names what undo would remove and prints the last action with its clock reading', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    await userEvent.setup().click(within(left).getByRole('button', { name: /Takedown/ }))
    expect(await screen.findByRole('button', { name: /Undo takedown \+2 Mateo Rivera/ })).toBeEnabled()
    expect(screen.getByText(/Takedown/, { selector: 'p' })).toHaveTextContent('Takedown +2 Mateo Rivera at 5:00')
  })

  // 6.16: the common error is the wrong side a minute ago, which one global undo cannot reach.
  it('offers the minus to the side that scored and refuses it, with a reason, on the other', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    const f = fakeFetch(url => feed.handle(url) ?? (url.endsWith('/events/last')
      ? { json: { match: sampleMatch({ lastSeq: 0 }), version: 3 } }
      : { json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }))
    await mount()
    const user = userEvent.setup()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    await user.click(within(left).getByRole('button', { name: /Takedown/ }))

    const forOlivia = await screen.findByRole('button', { name: /Minus.*Olivia Kim/ })
    expect(forOlivia).toBeDisabled()
    const forMateo = screen.getByRole('button', { name: 'Minus 2 Mateo Rivera' })
    expect(forMateo).toBeEnabled()

    await user.click(forMateo)
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/events/last')).toBe(true))
  })

  // 6.16: expiry is a frame, not a wash, and it holds. No flash, no toast, no repeat.
  it('holds the expiry alarm until the result is recorded, and sounds it once', async () => {
    const expired = expiredMatch()
    const feed = snapshotFeed(onOneMat(expired))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    expect(await screen.findByText('Time expired. Record the result.')).toBeInTheDocument()
    expect(playExpired).toHaveBeenCalledTimes(1)
    // The clock is not something the operator can restart, so it says so instead of
    // accepting the press.
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText('Time is up. Record the result.')).toBeInTheDocument()

    // It does not clear itself, and it does not sound again on later polls.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 3100)) })
    expect(screen.getByText('Time expired. Record the result.')).toBeInTheDocument()
    expect(playExpired).toHaveBeenCalledTimes(1)
  })

  // 1024 x 768 is the iPad's SCREEN. Safari lays this column out in the screen minus its
  // own chrome, and at the bottom of that range 6.16's floors do not all fit. What must
  // never happen is the two things that make the screen work going into a scroll box: the
  // scorer answers the alarm with End match, and both have to be reachable without a
  // scroll gesture on a tablet the operator is not looking at.
  it('keeps the expiry alarm and End match out of the scroller on the shortest layout viewport', async () => {
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', SHORTEST_VIEWPORT)
    const feed = snapshotFeed(onOneMat(expiredMatch()))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()

    const alarm = await screen.findByText('Time expired. Record the result.')
    const end = screen.getByRole('button', { name: 'End match' })
    const scroller = referenceRegion()
    expect(scroller.contains(alarm)).toBe(false)
    expect(scroller.contains(end)).toBe(false)
    expect(scroller.contains(screen.getByRole('button', { name: /^Undo/ }))).toBe(false)
    expect(scroller.contains(screen.getByRole('button', { name: 'Start' }))).toBe(false)
    // Nothing above the column may scroll either, or the whole stack goes with it.
    expect(centreColumn().className).not.toContain('overflow-y-auto')

    // What gives instead: the reference content, and at this height the SECONDARY minus
    // row goes with it. No commit control is shrunk to buy the fit.
    expect(scroller.contains(screen.getByText(/No action recorded on this tablet yet/))).toBe(true)
    expect(scroller.contains(screen.getByRole('button', { name: /Minus.*Mateo Rivera/ }))).toBe(true)
    for (const name of [/^Undo/, 'Start', 'End match'] as const) {
      expect(screen.getByRole('button', { name }).style.height).toBe('104px')
    }
  })

  it('keeps the minus row in the commit stack on a tablet tall enough to hold it', async () => {
    vi.stubGlobal('innerWidth', 1194)
    vi.stubGlobal('innerHeight', 900)
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    expect(referenceRegion().contains(screen.getByRole('button', { name: /Minus.*Mateo Rivera/ }))).toBe(false)
  })

  // 7.6's staleness notice takes the head's identity slot rather than adding a row under
  // the clock: a row added to the head is a row taken straight out of the guarantee above,
  // and at the shortest layout viewport there are three pixels to give.
  it('prints the staleness notice in the head slot instead of adding a row to it', () => {
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', SHORTEST_VIEWPORT)
    const match = expiredMatch()
    const mat = { id: 1, number: 1, current: match, onDeck: [], bound: true }
    const refusals = { clock: null, undo: null, minusA: null, minusB: null }
    const props = {
      mat, match, serverNow: sampleSnapshot().now, pollIntervalMs: 1000, expired: true,
      lastAction: null, refusals, error: null,
      onClock: () => {}, onUndo: () => {}, onMinus: () => {}, onEnd: () => {},
    }

    const fresh = render(<CenterColumn {...props} lastSuccessAt={Date.now()} />)
    expect(screen.getByText(/MAT 1/)).toBeInTheDocument()
    expect(screen.queryByText(/Not updating/)).toBeNull()
    fresh.unmount()

    render(<CenterColumn {...props} lastSuccessAt={Date.now() - 60_000} />)
    const notice = screen.getByText(/Not updating/)
    // One notice, in the identity slot, and not inside the region that scrolls.
    expect(screen.getAllByText(/Not updating/)).toHaveLength(1)
    expect(screen.queryByText(/MAT 1/)).toBeNull()
    expect(referenceRegion().contains(notice)).toBe(false)
  })

  it('does not steal the screen with a sheet when the clock runs out under a tie pick', async () => {
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'End match' }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('End the match?')
    // Picking a winner on a tie swaps the sheet from the two toggles to a decided summary,
    // so once picked, "Mateo Rivera wins" is the signal the pick stuck (the toggle is gone).
    await user.click(within(sheet).getByRole('button', { name: 'Mateo Rivera wins' }))
    expect(within(sheet).getByText(/Mateo Rivera wins/)).toBeInTheDocument()

    // The clock reaches zero while the sheet is open and mid-pick. The scorer's default
    // fixture has one idle mat, so the adaptive interval (pollInterval.ts) picks the 3000ms
    // live-idle rate, not a flat 1000ms.
    feed.push(onOneMat(expiredMatch()))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 3100)) })

    expect(playExpired).toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('End the match?')
    expect(within(screen.getByRole('dialog')).getByText(/Mateo Rivera wins/)).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record win by decision' })).toBeEnabled()
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

  // 6.16: below 900 CSS px or out of landscape, a plain page rather than a broken screen.
  it('refuses a phone and offers the board instead', async () => {
    vi.stubGlobal('innerWidth', 430)
    vi.stubGlobal('innerHeight', 932)
    fakeFetch(() => ({ json: {} }))
    await mount()
    expect(await screen.findByText(/Use a tablet for scoring/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the board' })).toHaveAttribute('href', '/board/1')
    expect(screen.queryByRole('region', { name: 'Mateo Rivera' })).toBeNull()
  })

  // STILL OPEN 8: the mat tablet is the one screen that must never sleep during a
  // live match, and it took no wake lock of its own -- the one MatPickPage
  // acquired at the code field is released the instant that route unmounts on
  // the navigate() into this one.
  it('acquires the screen wake lock while a mat is being scored', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn().mockResolvedValue({ addEventListener: vi.fn(), release })
    vi.stubGlobal('navigator', { wakeLock: { request } })
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    await screen.findByRole('region', { name: 'Mateo Rivera' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  })

  // Safari refuses navigator.wakeLock.request() outside a user gesture, so the
  // mount-time attempt above can fail on the exact hardware this matters for.
  // The handoff from MatPickPage must not leave the mat stuck asleep for the
  // rest of the match: the operator's first tap on the scoring screen asks again.
  it('re-asks for the wake lock on the first tap if the mount-time request was refused', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('not allowed'))
      .mockResolvedValueOnce({ addEventListener: vi.fn(), release })
    vi.stubGlobal('navigator', { wakeLock: { request } })
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    const left = await screen.findByRole('region', { name: 'Mateo Rivera' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))

    const user = userEvent.setup()
    await user.click(within(left).getByRole('button', { name: /Takedown/ }))
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  // A tablet that refuses the lock every time is the failure that ends the
  // afternoon quietly, so the scorer has to say it rather than swallow it.
  it('says the screen may sleep when the tablet refuses the lock outright', async () => {
    const request = vi.fn().mockRejectedValue(new Error('not allowed'))
    vi.stubGlobal('navigator', { wakeLock: { request } })
    const feed = snapshotFeed(sampleSnapshot())
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    await mount()
    const note = await screen.findByText(/Screen may sleep/)
    expect(note).toBeInTheDocument()
    // It must sit above the score sides, never over a control the scorer taps.
    const left = screen.getByRole('region', { name: 'Mateo Rivera' })
    expect(note.compareDocumentPosition(left) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

// 4.4's held commit means an open dialog suspends the snapshot on this route too, so the
// changed-score path is driven here directly rather than through a poll. useScorer's own
// suite proves that the second confirm() sends nothing; what is proved here is that the
// operator is not handed a way to press through it without reading it.
describe('ConfirmSheet', () => {
  const teams = sampleSnapshot().teams
  const tie = { winner: null, winType: null, scores: { a: 0, b: 0 } }
  const decided = { winner: 200, winType: 'points' as const, scores: { a: 0, b: 3 } }

  function renderSheet(sheet: SheetState, over: Partial<{ match: ReturnType<typeof sampleMatch>; error: string | null; onPick: (id: number) => void; onConfirm: () => void }> = {}) {
    const props = {
      match: sampleMatch({ b: { ...sampleMatch().b, score: 3 } }),
      error: null as string | null,
      onPick: () => {},
      onConfirm: () => {},
      ...over,
    }
    render(<ConfirmSheet sheet={sheet} teams={teams} busy={false} onCancel={() => {}} {...props} />)
    return props
  }

  // The refusal returned synchronously with the newly derived winner already set and the
  // affirmative still enabled, in place and immediately valid, so the second half of a
  // double tap recorded a win for the competitor the operator never picked -- the same
  // silent wrong winner the refusal exists to stop, one press further along.
  it('offers no affirmative until the operator answers the change with a new decision', async () => {
    const picks: number[] = []
    const onConfirm = vi.fn()
    renderSheet(
      { reason: 'end', shown: decided, changed: { was: tie, now: decided }, winner: null, winType: null },
      { onPick: id => picks.push(id), onConfirm, error: 'The score changed. Read the new result, then record it.' },
    )
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('alert')).toHaveTextContent('It now says Olivia Kim on points, 0 to 3')

    const record = within(sheet).getByRole('button', { name: /^Record win/ })
    expect(record).toBeDisabled()
    await userEvent.setup().click(record)
    expect(onConfirm).not.toHaveBeenCalled()

    // The only way forward names a competitor, and it is not the control the double tap
    // was already landing on.
    const answer = within(sheet).getByRole('button', { name: 'Olivia Kim wins on points' })
    expect(answer).not.toBe(record)
    await userEvent.setup().click(answer)
    expect(picks).toEqual([200])
  })

  // A change that lands on a tie has no derived winner to name, so the operator picks one
  // -- and that pick is the acknowledgement.
  it('asks for a decision again when the change leaves the match tied', async () => {
    const picks: number[] = []
    renderSheet(
      { reason: 'end', shown: tie, changed: { was: decided, now: tie }, winner: null, winType: null },
      { onPick: id => picks.push(id) },
    )
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('alert')).toHaveTextContent('It now says a tie, 0 to 0')
    expect(within(sheet).getByRole('button', { name: /^Record win/ })).toBeDisabled()
    await userEvent.setup().click(within(sheet).getByRole('button', { name: 'Mateo Rivera wins' }))
    expect(picks).toEqual([100])
  })

  // 6.16's restatement froze the winner and the win type but read the score live, so
  // between the raise and the press it could print a score that contradicted the
  // competitor it named.
  it('restates the score the sheet was raised on, never the live one', async () => {
    renderSheet(
      { reason: 'end', shown: { winner: 100, winType: 'points', scores: { a: 4, b: 2 } }, changed: null, winner: 100, winType: 'points' },
      // The desk has since put the other competitor ahead. The line must not print 4 to 9
      // beside a sentence saying Mateo Rivera won.
      { match: sampleMatch({ a: { ...sampleMatch().a, score: 4 }, b: { ...sampleMatch().b, score: 9 } }) },
    )
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('Mateo Rivera wins on points,4to2')
    expect(sheet).not.toHaveTextContent('9')
  })
})
