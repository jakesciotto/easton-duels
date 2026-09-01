import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { MatView, MatchView, Snapshot } from '@shared/types'
import { routes } from '@/router'
import { Board } from '@/routes/board/Board'
import { fakeFetch, snapshotFeed, sampleMatch, sampleSnapshot } from './fakes'

afterEach(() => vi.unstubAllGlobals())

const RUNNING = { elapsedMs: 0, startedAt: '2026-10-03T15:59:00.000Z', lengthMs: 300_000 }
const PAUSED = { elapsedMs: 0, startedAt: null, lengthMs: 300_000 }

function pair(id: number, aName: string, bName: string, over: Partial<MatchView> = {}): MatchView {
  const base = sampleMatch({ id, ...over })
  return { ...base, a: { ...base.a, name: aName }, b: { ...base.b, name: bName } }
}

function mat(id: number, over: Partial<MatView> = {}): MatView {
  return { id, number: id, current: null, onDeck: [], bound: false, ...over }
}

function liveBoard(count: number, over: Partial<Snapshot> = {}): Snapshot {
  const mats = Array.from({ length: count }, (_, i) =>
    mat(i + 1, { current: pair(100 + i, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), bound: true }))
  return sampleSnapshot({ mats, matches: mats.map(m => m.current!), ...over })
}

function safe(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-comp]')
  if (!el) throw new Error('no safe layer')
  return el as HTMLElement
}

function row(name: string): HTMLElement {
  const el = screen.getByRole('region', { name }).querySelector('.b-row')
  if (!el) throw new Error(`no row in ${name}`)
  return el as HTMLElement
}

describe('Board compositions', () => {
  it('renders the cold start as a real composition, not a blank screen', () => {
    const { container } = render(<Board snapshot={null} connected />)
    expect(safe(container)).toHaveAttribute('data-comp', 'cold')
    expect(screen.getByRole('region', { name: 'Scoreboard' })).toBeInTheDocument()
    // Both bars, both plates and both names are in their final positions; only the
    // values are skeletons.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(10)
    expect(screen.getAllByText('Wins')).toHaveLength(2)
  })

  it('is the data entry panel when no mat carries a match', () => {
    const done = (id: number, endedAt: string) => pair(id, 'Ava Park', 'Sofia Diaz', {
      status: 'done', endedAt, result: { winnerAthleteId: 100, winType: 'submission' },
    })
    const matches = [1, 2, 3, 4, 5].map(i => done(i, `2026-10-03T16:0${i}:00.000Z`))
    const { container } = render(<Board snapshot={sampleSnapshot({ mats: [mat(1)], matches })} connected />)

    expect(safe(container)).toHaveAttribute('data-comp', 'entry')
    // The last four results, newest first, and the running count of every one entered.
    const rows = screen.getAllByRole('region', { name: /^Result/ })
    expect(rows).toHaveLength(4)
    expect(screen.getByText(/Results entered:/)).toHaveTextContent('Results entered: 5')
    // Reloading a board that has been up all afternoon must not flash old results as
    // if they had just landed, so the first batch is already settled.
    expect(rows[0].querySelector('.b-row')).toHaveClass('b-row-settled')
  })

  it('carries the clock and four upcoming pairs at one mat', () => {
    const queue = [11, 12, 13, 14, 15].map(id => pair(id, `Kai${id} Nakamura`, `Rosa${id} Oliveira`, { status: 'pending' }))
    const snapshot = sampleSnapshot({
      mats: [mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), onDeck: queue, bound: true })],
      matches: [],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-mats', '1')
    expect(within(row('Mat 1')).getByText(/^\d+:\d{2}$/)).toBeInTheDocument()
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(4)
    expect(screen.getByText('Kai14')).toBeInTheDocument()
    expect(screen.queryByText('Kai15')).not.toBeInTheDocument()
  })

  it('carries the clock and one upcoming pair per mat at two mats', () => {
    const snapshot = liveBoard(2, {
      mats: [
        mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), onDeck: [pair(20, 'Ana Bravo', 'Nina Costa', { status: 'pending' })], bound: true }),
        mat(2, { current: pair(11, 'Jayden Rocha', 'Ben Oliveira', { clock: PAUSED }), onDeck: [pair(21, 'Ivy Santos', 'Zoe Marino', { status: 'pending' })], bound: true }),
      ],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-mats', '2')
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(2)
    expect(within(row('Mat 1')).getByText(/^\d+:\d{2}$/)).toBeInTheDocument()
    expect(row('Mat 1')).toHaveClass('b-row-live')
    expect(row('Mat 2')).not.toHaveClass('b-row-live')
  })

  it('becomes a clockless ledger above two mats', () => {
    for (const count of [3, 4]) {
      const { container, unmount } = render(<Board snapshot={liveBoard(count)} connected />)
      expect(safe(container)).toHaveAttribute('data-mats', String(count))
      expect(screen.getAllByRole('region', { name: /^Mat / })).toHaveLength(count)
      // The per mat clock is what pays for the name field, so it is deleted here.
      expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument()
      expect(container.querySelectorAll('.b-next-line')).toHaveLength(0)
      unmount()
    }
  })

  it('names are first name plus last initial at every mat count', () => {
    for (const count of [1, 2, 3, 4]) {
      const { unmount } = render(<Board snapshot={liveBoard(count)} connected />)
      expect(within(row('Mat 1')).getByText('Mateo')).toBeInTheDocument()
      expect(within(row('Mat 1')).getByText('R.')).toBeInTheDocument()
      expect(screen.queryByText('Mateo Rivera')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('flies the live cue only while that mat is running', () => {
    const snapshot = sampleSnapshot({
      mats: [
        mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), bound: true }),
        mat(2, { current: pair(11, 'Ava Park', 'Nina Costa', { clock: PAUSED }), bound: true }),
        mat(3, { current: null }),
      ],
      matches: [],
    })
    render(<Board snapshot={snapshot} connected />)
    expect(row('Mat 1')).toHaveClass('b-row-live')
    expect(row('Mat 2')).not.toHaveClass('b-row-live')
    expect(row('Mat 3')).not.toHaveClass('b-row-live')
  })

  it('drops everything the brief deletes from the board', () => {
    const snapshot = liveBoard(3)
    render(<Board snapshot={snapshot} connected />)
    expect(screen.queryByText(/Grey/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/lb/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Match \d/)).not.toBeInTheDocument()
    expect(screen.queryByText('vs')).not.toBeInTheDocument()
    expect(screen.queryByText(/by submission/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'On deck' })).not.toBeInTheDocument()
  })

  it('closes on a final summary of wins, points and matches', () => {
    const snapshot = sampleSnapshot({
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', matCount: 1 },
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 41 },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 33 },
      ],
      matches: [pair(1, 'Ava Park', 'Sofia Diaz', { status: 'done' })],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-comp', 'done')
    const summary = screen.getByRole('region', { name: 'Final' })
    expect(within(summary).getByText('7')).toBeInTheDocument()
    expect(within(summary).getByText('41')).toBeInTheDocument()
    expect(within(summary).getAllByText('Matches')).toHaveLength(2)
    // The leading numeral is the brighter of the two figure tones.
    const hero = screen.getByRole('region', { name: 'Scoreboard' })
    expect(within(hero).getByText('7')).toHaveClass('b-lead')
    expect(within(hero).getByText('5')).toHaveClass('b-trail')
  })

  it('raises the stale bar when the poll stops landing', () => {
    const { container, rerender } = render(<Board snapshot={liveBoard(1)} connected />)
    expect(container.querySelector('.b-stale')).toBeNull()
    rerender(<Board snapshot={liveBoard(1)} connected={false} />)
    expect(container.querySelector('.b-stale')).not.toBeNull()
  })
})

describe('Board result settling', () => {
  afterEach(() => vi.useRealTimers())

  it('holds a finished result, then goes monotone and stays there', () => {
    vi.useFakeTimers()
    const live = pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING })
    const finished = { ...live, status: 'done' as const, clock: PAUSED, result: { winnerAthleteId: 100, winType: 'submission' as const } }
    const before = sampleSnapshot({ mats: [mat(1, { current: live, bound: true })], matches: [live] })
    const after = sampleSnapshot({ mats: [mat(1, { current: null, bound: true })], matches: [finished] })

    const { rerender } = render(<Board snapshot={before} connected />)
    rerender(<Board snapshot={after} connected />)

    expect(row('Mat 1')).not.toHaveClass('b-row-settled')
    expect(within(row('Mat 1')).getByText('Mateo')).toBeInTheDocument()

    vi.advanceTimersByTime(11_000)
    rerender(<Board snapshot={after} connected />)
    expect(row('Mat 1')).toHaveClass('b-row-settled')

    vi.advanceTimersByTime(60_000)
    rerender(<Board snapshot={after} connected />)
    expect(row('Mat 1')).toHaveClass('b-row-settled')
    expect(within(row('Mat 1')).getByText('Mateo')).toBeInTheDocument()
  })
})

describe('BoardPage route', () => {
  it('polls the snapshot endpoint and paints the live board', async () => {
    const feed = snapshotFeed(liveBoard(1))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Mat 1' })).toBeInTheDocument())
    expect(within(screen.getByRole('region', { name: 'Scoreboard' })).getAllByText('Wins')).toHaveLength(2)
  })
})
