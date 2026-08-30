import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { setMatBinding } from '@/lib/auth'
import { beep } from '@/lib/sounds'
import { fakeFetch, FakeEventSource, sampleMatch, sampleSnapshot } from './fakes'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

vi.mock('@/lib/sounds', () => ({ beep: vi.fn(), unlockAudio: vi.fn() }))
beforeEach(() => { localStorage.clear(); setMatBinding({ eventId: 1, matId: 1, matNumber: 1, eventName: 'Fall Duels', token: 'mat-tok' }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeEventSource.instances = [] })

function mount() {
  vi.stubGlobal('EventSource', FakeEventSource)
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/mat/1'] })} />)
  return FakeEventSource.instances[0]
}

describe('ScorerPage', () => {
  it('disables scoring until the stream connects, then posts a tap with the match seq', async () => {
    const f = fakeFetch(() => ({ json: { match: sampleMatch({ lastSeq: 1, a: { ...sampleMatch().a, score: 2 } }), version: 2 } }))
    const es = mount()
    expect(await screen.findByRole('status')).toHaveTextContent(/Reconnecting/)
    act(() => es.emit('snapshot', sampleSnapshot()))
    const left = screen.getByRole('region', { name: 'Mateo Rivera' })
    const takedown = within(left).getByRole('button', { name: /Takedown/ })
    expect(takedown).toBeEnabled()
    await userEvent.setup().click(takedown)
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/events')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/matches/10/events'))
    expect(body).toMatchObject({ type: 'score', athleteId: 100, actionKey: 'takedown', lastSeq: 0 })
    expect((f.calls.find(c => c.url === '/api/matches/10/events')!.init!.headers as Record<string, string>).authorization).toBe('Bearer mat-tok')
  })

  it('opens the confirm sheet after a terminal with the winner preselected and ends the match', async () => {
    const f = fakeFetch(url => url.endsWith('/end')
      ? { json: { match: sampleMatch({ status: 'done', result: { winnerAthleteId: 200, winType: 'submission' } }), version: 3 } }
      : { json: { match: sampleMatch({ lastSeq: 1, pendingTerminal: { athleteId: 200, actionKey: 'pin' } }), version: 2 } })
    const es = mount()
    act(() => es.emit('snapshot', sampleSnapshot()))
    const user = userEvent.setup()
    await user.click(within(screen.getByRole('region', { name: 'Olivia Kim' })).getByRole('button', { name: 'Pin' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/Olivia Kim wins by submission/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 1 })
  })

  it('asks for a decision on a tie and sends the picked winner', async () => {
    const f = fakeFetch(() => ({ json: { match: sampleMatch({ status: 'done' }), version: 3 } }))
    const es = mount()
    act(() => es.emit('snapshot', sampleSnapshot()))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'End match' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await user.click(within(sheet).getByRole('button', { name: /Mateo Rivera/ }))
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 0, winnerAthleteId: 100 })
  })

  it('shows the empty state when the mat has no match', () => {
    fakeFetch(() => ({ json: {} }))
    const es = mount()
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }], matches: [] })))
    expect(screen.getByText(/No match on this mat/)).toBeInTheDocument()
  })

  it('beeps and opens the confirm sheet once the server confirms the clock has expired', async () => {
    fakeFetch(() => ({ json: {} }))
    const es = mount()
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: expired, onDeck: [], bound: true }], matches: [expired] })))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Time is up')
    expect(beep).toHaveBeenCalled()
  })

  it('keeps an in-progress End match tie pick when the clock expires under it', async () => {
    fakeFetch(() => ({ json: {} }))
    const es = mount()
    act(() => es.emit('snapshot', sampleSnapshot()))
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
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: expired, onDeck: [], bound: true }], matches: [expired] })))

    expect(beep).toHaveBeenCalled()
    sheet = screen.getByRole('dialog')
    expect(sheet).toHaveTextContent('End the match?')
    expect(within(sheet).getByText(/Mateo Rivera wins/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('does not auto-retry a 409 sequence conflict, and sends the corrected seq on the next tap', async () => {
    let scoreAttempts = 0
    const f = fakeFetch(url => {
      if (url !== '/api/matches/10/events') return { json: {} }
      scoreAttempts++
      if (scoreAttempts === 1) {
        return { status: 409, json: { error: { code: 'sequence', message: 'stale sequence', currentSeq: 7, match: sampleMatch({ lastSeq: 7 }) } } }
      }
      return { json: { match: sampleMatch({ lastSeq: 8 }), version: 5 } }
    })
    const es = mount()
    act(() => es.emit('snapshot', sampleSnapshot()))
    const left = screen.getByRole('region', { name: 'Mateo Rivera' })
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

  it('clears the expiry flash after its timeout', () => {
    vi.useFakeTimers({ now: T0 })
    fakeFetch(() => ({ json: {} }))
    const es = mount()
    const expired = sampleMatch({ clock: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: expired, onDeck: [], bound: true }], matches: [expired] })))
    const center = screen.getByText('0:00').closest('div')!
    expect(center).toHaveClass('bg-warn/10')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(center).not.toHaveClass('bg-warn/10')
  })

  it('heartbeats at mount, again after 20 seconds, and stops after unmount', () => {
    vi.useFakeTimers({ now: T0 })
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const heartbeats = () => f.calls.filter(c => c.url === '/api/mats/1/heartbeat')
    expect(heartbeats()).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(heartbeats()).toHaveLength(2)
    cleanup()
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(heartbeats()).toHaveLength(2)
  })
})
