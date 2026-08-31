import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, within, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { FakeEventSource, sampleMatch, sampleSnapshot } from './fakes'

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

async function mount() {
  vi.stubGlobal('EventSource', FakeEventSource)
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
  await waitFor(() => expect(FakeEventSource.instances[0]).toBeDefined())
  return FakeEventSource.instances[0]
}

describe('BoardPage', () => {
  it('shows team wins and points, a live tile per mat, and the on-deck strip', async () => {
    const es = await mount()
    const next = sampleMatch({ id: 11, status: 'pending', a: { ...sampleMatch().a, name: 'Ava Park' } })
    act(() => es.emit('snapshot', sampleSnapshot({
      teams: [{ id: 1, name: 'Boulder', color: 'red', position: 0, wins: 3, points: 21 }, { id: 2, name: 'Denver', color: 'blue', position: 1, wins: 2, points: 17 }],
      mats: [{ id: 1, number: 1, current: sampleMatch({ a: { ...sampleMatch().a, score: 4 } }), onDeck: [next], bound: true }],
    })))
    const hero = screen.getByRole('region', { name: 'Scoreboard' })
    expect(within(hero).getByText('3')).toBeInTheDocument()
    expect(within(hero).getByText('21 pts')).toBeInTheDocument()
    const tile = screen.getByRole('region', { name: 'Mat 1' })
    expect(within(tile).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(tile).getByText('4')).toBeInTheDocument()
    expect(within(tile).getByText('5:00')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'On deck' })).toHaveTextContent('Ava Park')
  })

  it('falls back to the latest results when no mat is active', async () => {
    const es = await mount()
    const done = (id: number) => sampleMatch({ id, status: 'done', a: { ...sampleMatch().a, score: 6 }, result: { winnerAthleteId: 100, winType: 'submission' } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }], matches: [done(1), done(2), done(3), done(4), done(5)] })))
    expect(screen.getAllByRole('region', { name: /Result/ })).toHaveLength(4)
    expect(screen.getByText('Results entered: 5')).toBeInTheDocument()
    expect(screen.getAllByText(/by submission/)).toHaveLength(4)
  })

  it('fills the screen with the winner when the event is done', async () => {
    const es = await mount()
    act(() => es.emit('snapshot', sampleSnapshot({
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', matCount: 1 },
      teams: [{ id: 1, name: 'Boulder', color: 'red', position: 0, wins: 5, points: 30 }, { id: 2, name: 'Denver', color: 'blue', position: 1, wins: 4, points: 28 }],
    })))
    expect(screen.getByRole('heading', { name: 'Boulder wins' })).toBeInTheDocument()
  })

  it('colours the clock green while running and not while paused', async () => {
    const es = await mount()
    const running = sampleMatch({ id: 20, clock: { elapsedMs: 0, startedAt: '2026-10-03T15:59:00.000Z', lengthMs: 300_000 } })
    const paused = sampleMatch({ id: 21, clock: { elapsedMs: 0, startedAt: null, lengthMs: 300_000 } })
    act(() => es.emit('snapshot', sampleSnapshot({
      mats: [
        { id: 1, number: 1, current: running, onDeck: [], bound: true },
        { id: 2, number: 2, current: paused, onDeck: [], bound: true },
      ],
    })))
    const mat1 = screen.getByRole('region', { name: 'Mat 1' })
    const mat2 = screen.getByRole('region', { name: 'Mat 2' })
    expect(within(mat1).getByText(/^\d+:\d{2}$/)).toHaveClass('text-ok')
    expect(within(mat2).getByText(/^\d+:\d{2}$/)).not.toHaveClass('text-ok')
  })

  it('shows a submission pending badge while a terminal is pending on the live match', async () => {
    const es = await mount()
    const pending = sampleMatch({ id: 30, pendingTerminal: { athleteId: 100, actionKey: 'submission' } })
    act(() => es.emit('snapshot', sampleSnapshot({
      mats: [{ id: 1, number: 1, current: pending, onDeck: [], bound: true }],
    })))
    expect(screen.getByText('Submission pending')).toBeInTheDocument()

    const resolved = { ...pending, pendingTerminal: null }
    act(() => es.emit('snapshot', sampleSnapshot({
      version: 2,
      mats: [{ id: 1, number: 1, current: resolved, onDeck: [], bound: true }],
    })))
    expect(screen.queryByText('Submission pending')).not.toBeInTheDocument()
  })
})
