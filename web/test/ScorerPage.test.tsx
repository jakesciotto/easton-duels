import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { setMatBinding } from '@/lib/auth'
import { beep } from '@/lib/sounds'
import { fakeFetch, FakeEventSource, sampleMatch, sampleSnapshot } from './fakes'

vi.mock('@/lib/sounds', () => ({ beep: vi.fn(), unlockAudio: vi.fn() }))
beforeEach(() => { localStorage.clear(); setMatBinding({ eventId: 1, matId: 1, matNumber: 1, eventName: 'Fall Duels', token: 'mat-tok' }) })
afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

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
})
