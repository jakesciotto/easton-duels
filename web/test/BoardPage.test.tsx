import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { FakeEventSource, sampleMatch, sampleSnapshot } from './fakes'

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

function mount() {
  vi.stubGlobal('EventSource', FakeEventSource)
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
  return FakeEventSource.instances[0]
}

describe('BoardPage', () => {
  it('shows team wins and points, a live tile per mat, and the on-deck strip', () => {
    const es = mount()
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

  it('falls back to the latest results when no mat is active', () => {
    const es = mount()
    const done = (id: number) => sampleMatch({ id, status: 'done', a: { ...sampleMatch().a, score: 6 }, result: { winnerAthleteId: 100, winType: 'submission' } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }], matches: [done(1), done(2), done(3), done(4), done(5)] })))
    expect(screen.getAllByRole('region', { name: /Result/ })).toHaveLength(4)
    expect(screen.getByText('Results entered: 5')).toBeInTheDocument()
    expect(screen.getAllByText(/by submission/)).toHaveLength(4)
  })

  it('fills the screen with the winner when the event is done', () => {
    const es = mount()
    act(() => es.emit('snapshot', sampleSnapshot({
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', matCount: 1 },
      teams: [{ id: 1, name: 'Boulder', color: 'red', position: 0, wins: 5, points: 30 }, { id: 2, name: 'Denver', color: 'blue', position: 1, wins: 4, points: 28 }],
    })))
    expect(screen.getByRole('heading', { name: 'Boulder wins' })).toBeInTheDocument()
  })
})
