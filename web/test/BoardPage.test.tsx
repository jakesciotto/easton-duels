import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { render, screen, within, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { MatView, MatchView, Snapshot } from '@shared/types'
import { routes } from '@/router'
import { Board } from '@/routes/board/Board'
import { FLOOR_NOTE_MATS, boardBudget } from '@/routes/board/budget'
import { fakeFetch, snapshotFeed, sampleMatch, sampleSnapshot } from './fakes'

afterEach(() => {
  vi.unstubAllGlobals()
  // --far persists to localStorage now, so one test's calibration would otherwise be
  // read back by the next one.
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

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
    // 6.15 is exact: both bars, both plates and both names hold their final positions
    // and ONLY the two wins numerals are skeletons.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2)
    expect(container.querySelectorAll('.b-bar')).toHaveLength(2)
    expect(container.querySelectorAll('.b-code')).toHaveLength(2)
    for (const box of container.querySelectorAll('.b-bar, .b-code, .b-team-name')) {
      expect(box).not.toHaveAttribute('data-slot', 'skeleton')
    }
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

  it('renders every mat of an event configured above four', () => {
    // The API accepts up to eight mats and the New event dialog offers them, so a six
    // mat event used to lose mats five and six off the bottom of the band silently.
    const { container } = render(<Board snapshot={liveBoard(6)} connected />)
    expect(safe(container)).toHaveAttribute('data-mats', '6')
    expect(screen.getAllByRole('region', { name: /^Mat / })).toHaveLength(6)
    expect(screen.getByRole('region', { name: 'Mat 6' })).toBeInTheDocument()
    // Six panels and five gaps come to the whole band, and the row's type steps down to
    // the panel it was given rather than being cut off inside it.
    const six = boardBudget({ comp: 'mats', mats: 6, far: 1, note: false })
    expect(Number(safe(container).style.getPropertyValue('--b-panel-n'))).toBeCloseTo(six.panel, 6)
    expect(Number(safe(container).style.getPropertyValue('--b-row-n'))).toBeCloseTo(six.row, 6)
    expect(6 * six.panel + 5 * six.matGap).toBeCloseTo(six.band, 6)
  })

  it('drops the mats it cannot say at the floor step and names where they went', () => {
    // 3.4: nothing on the board is smaller than b3, and a fact that cannot be said at
    // b3 is deleted from the board and lives on the Live tab. Seven panels cannot hold
    // b3 on a 16:9 stage, so the count drops rather than the type. Shrinking instead
    // would put every name below the acuity threshold the whole board is derived from.
    const seven = render(<Board snapshot={liveBoard(7)} connected />)
    expect(screen.getByText(FLOOR_NOTE_MATS)).toBeInTheDocument()
    const shown = screen.getAllByRole('region', { name: /^Mat / })
    expect(shown.length).toBeLessThan(7)
    // The note itself takes a line, so the count that fits is the one computed with it.
    const withNote = boardBudget({ comp: 'mats', mats: 7, far: 1, note: true })
    expect(shown).toHaveLength(withNote.matsShown)
    expect(withNote.row).toBeGreaterThanOrEqual(9)
    // Mat 1 is always the top row, so the mats that survive are the first ones.
    expect(shown[0]).toHaveAccessibleName('Mat 1')
    seven.unmount()

    render(<Board snapshot={liveBoard(4)} connected />)
    expect(screen.queryByText(FLOOR_NOTE_MATS)).not.toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: /^Mat / })).toHaveLength(4)
  })

  it('gives the note its own line of the composition instead of covering one', () => {
    // The note used to be absolutely positioned over the foot of the safe frame, which
    // on a four mat board covers most of mat 4's name line.
    const { container } = render(<Board snapshot={liveBoard(4)} connected screenMaySleep />)
    const noted = boardBudget({ comp: 'mats', mats: 4, far: 1, note: true })
    const quiet = boardBudget({ comp: 'mats', mats: 4, far: 1, note: false })
    expect(noted.band).toBeLessThan(quiet.band)
    expect(Number(safe(container).style.getPropertyValue('--b-band-n'))).toBeCloseTo(noted.band, 6)
    expect(noted.hero + noted.heroGap + noted.band + noted.noteGap + noted.note).toBeCloseTo(90, 6)
  })

  it('trades queue depth for type when the room is calibrated deeper', () => {
    // A deeper room buys bigger type and pays for it in depth, per 3.4. Four next lines
    // under a single mat at far 1, two at far 1.2, and never a clipped fifth.
    window.history.replaceState({}, '', '/board/1?far=1.2')
    const queue = [11, 12, 13, 14, 15].map(id => pair(id, `Kai${id} Nakamura`, `Rosa${id} Oliveira`, { status: 'pending' }))
    const snapshot = sampleSnapshot({
      mats: [mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), onDeck: queue, bound: true })],
      matches: [],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(2)
  })

  it('stays on the mat ledger when bound mats are between bouts', () => {
    // Held results are derived from transitions this client watched, so they are empty
    // on the first snapshot after a reload. Four bouts ending together used to repaint
    // the whole board as a Final Score panel until the next one started.
    const done = pair(1, 'Ava Park', 'Sofia Diaz', {
      status: 'done', endedAt: '2026-10-03T16:01:00.000Z', result: { winnerAthleteId: 100, winType: 'submission' },
    })
    const snapshot = sampleSnapshot({
      mats: [1, 2, 3, 4].map(n => mat(n, { bound: true })),
      matches: [done],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)
    expect(safe(container)).toHaveAttribute('data-comp', 'mats')
    expect(screen.getAllByRole('region', { name: /^Mat / })).toHaveLength(4)
  })

  it('shows what is first up on each mat while the event is still in setup', () => {
    const queue = (m: number) => [1, 2, 3, 4].map(i =>
      pair(m * 10 + i, `Kai${m}${i} Nakamura`, `Rosa${m}${i} Oliveira`, { status: 'pending' }))
    const snapshot = sampleSnapshot({
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'setup', matCount: 2 },
      mats: [mat(1, { onDeck: queue(1), bound: true }), mat(2, { onDeck: queue(2), bound: true })],
      matches: [],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-comp', 'setup')
    expect(screen.getByText('Mat 1 first up')).toBeInTheDocument()
    expect(screen.getByText('Mat 2 first up')).toBeInTheDocument()
    // Three pairings per mat, per 6.15, and the fourth is not on the board.
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(6)
    expect(screen.getByText('Kai13')).toBeInTheDocument()
    expect(screen.queryByText('Kai14')).not.toBeInTheDocument()
  })

  // Seen on the real board against a new event: "Mat 1 first up" over an empty column and
  // the rest of a 55 inch panel black. A head with nothing under it reads as a board that
  // failed to load, and the room cannot ask anyone.
  it('says a mat is not drawn yet rather than heading an empty column', () => {
    const snapshot = sampleSnapshot({
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'setup', matCount: 1 },
      mats: [mat(1, { onDeck: [], bound: true })],
      matches: [],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-comp', 'setup')
    expect(screen.getByText('Mat 1 first up')).toBeInTheDocument()
    expect(screen.getByText('Not drawn yet')).toBeInTheDocument()
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(0)
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
    // The leading numeral is the brighter of the two figure tones. The tone is on the
    // figure, whose crossfade slots carry the digits.
    const hero = screen.getByRole('region', { name: 'Scoreboard' })
    expect(within(hero).getByText('7').closest('.b-fig')).toHaveClass('b-lead')
    expect(within(hero).getByText('5').closest('.b-fig')).toHaveClass('b-trail')
  })

  it('raises the stale bar when the poll stops landing', () => {
    const { container, rerender } = render(<Board snapshot={liveBoard(1)} connected />)
    expect(container.querySelector('.b-stale')).toBeNull()
    rerender(<Board snapshot={liveBoard(1)} connected={false} />)
    expect(container.querySelector('.b-stale')).not.toBeNull()
  })
})

describe('Board freshness', () => {
  // The snapshot's clock started a minute before its own `now`, so a board that is
  // still being fed reads 4:00 and one frozen ten and a half seconds ago reads 4:11.
  it('freezes the clock and says so in words when the server goes quiet', () => {
    render(<Board snapshot={liveBoard(1)} connected lastSuccessAt={Date.now() - 10_500} />)

    const clock = within(row('Mat 1')).getByText(/^\d+:\d{2}$/)
    expect(clock).toHaveTextContent('4:11')
    expect(clock).toHaveClass('b-clock-stale')
    // 4.3: never a colour on its own, and never a bar at the edge of the stage either.
    expect(screen.getByText(/^Not updating \d+s$/)).toBeInTheDocument()
  })

  it('keeps interpolating while the poll is still landing', () => {
    render(<Board snapshot={liveBoard(1)} connected lastSuccessAt={Date.now()} />)
    const clock = within(row('Mat 1')).getByText(/^\d+:\d{2}$/)
    expect(clock).toHaveTextContent('4:00')
    expect(clock).not.toHaveClass('b-clock-stale')
    expect(screen.queryByText(/Not updating/)).not.toBeInTheDocument()
  })

  it('carries every step of the 7.6 clock ladder on the board itself', () => {
    const clocks = {
      running: RUNNING,
      paused: PAUSED,
      near: { elapsedMs: 270_000, startedAt: '2026-10-03T15:59:59.000Z', lengthMs: 300_000 },
      expired: { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 },
    }
    const board = (one: keyof typeof clocks, two: keyof typeof clocks) => sampleSnapshot({
      mats: [
        mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: clocks[one] }), bound: true }),
        mat(2, { current: pair(11, 'Ava Park', 'Nina Costa', { clock: clocks[two] }), bound: true }),
      ],
      matches: [],
    })
    const clockOn = (name: string) => within(row(name)).getByText(/^\d+:\d{2}$/)

    const first = render(<Board snapshot={board('running', 'paused')} connected />)
    expect(clockOn('Mat 1').className).toBe('b-clock')
    expect(clockOn('Mat 2')).toHaveClass('b-clock-paused')
    first.unmount()

    render(<Board snapshot={board('near', 'expired')} connected />)
    expect(clockOn('Mat 1')).toHaveClass('b-clock-near')
    expect(clockOn('Mat 2')).toHaveClass('b-clock-expired')
  })

  it('says the screen may sleep where the room can read it', () => {
    render(<Board snapshot={liveBoard(1)} connected screenMaySleep />)
    const note = screen.getByText('Screen may sleep')
    expect(note.parentElement).toHaveClass('b-note')
    // Inside the safe area, not in the letterbox margin outside it.
    expect(note.closest('.b-safe')).not.toBeNull()
  })
})

describe('Board calibration', () => {
  it('grows the type from a far setting without moving the safe frame', () => {
    window.history.replaceState({}, '', '/board/1?far=1.2')
    const { container } = render(<Board snapshot={liveBoard(1)} connected />)

    const stage = container.querySelector('.b-stage') as HTMLElement
    // First paint, not after an effect: the board is opened once and left.
    expect(stage.style.getPropertyValue('--far')).toBe('1.2')
    expect(safe(container).style.transform).toBe('')
    // 3.4: the knob persists, so the next plain visit to /board/1 keeps the setting.
    expect(window.localStorage.getItem('duels.board.far')).toBe('1.2')
  })

  it('clamps a hand typed setting to the three the frame can hold', () => {
    // The safe frame is a fixed 90cqh while every step inside it scales, so the range
    // the compositions are proven against IS the range 3.4 documents. A ?far= past it
    // would buy a board that has to shrink something to fit.
    const far = (query: string) => {
      window.history.replaceState({}, '', `/board/1${query}`)
      const view = render(<Board snapshot={liveBoard(1)} connected />)
      const value = (view.container.querySelector('.b-stage') as HTMLElement).style.getPropertyValue('--far')
      view.unmount()
      window.localStorage.clear()
      return value
    }
    expect(far('?far=3')).toBe('1.2')
    expect(far('?far=0.2')).toBe('0.85')
    expect(far('?far=1.05')).toBe('1.05')
  })
})

describe('Board figure change', () => {
  function scored(score: number): Snapshot {
    const base = pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING })
    const match = { ...base, a: { ...base.a, score } }
    return sampleSnapshot({ mats: [mat(1, { current: match, bound: true })], matches: [match] })
  }

  it('crossfades the whole numeral, keeping the old one mounted to fade out', () => {
    const { rerender } = render(<Board snapshot={scored(0)} connected />)
    rerender(<Board snapshot={scored(2)} connected />)

    const fig = row('Mat 1').querySelector('.b-score-a') as HTMLElement
    const slots = [...fig.querySelectorAll('span')]
    expect(slots.map(s => s.textContent)).toEqual(['0', '2'])
    expect(slots[1]).toHaveClass('b-fig-on')
    expect(slots[0]).not.toHaveClass('b-fig-on')
    // Only the incoming value is announced.
    expect(slots[0]).toHaveAttribute('aria-hidden', 'true')
    expect(slots[1]).toHaveAttribute('aria-hidden', 'false')
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
  // Read from disk for the same reason board-css.test.ts does: the claim is about what
  // the file contains, and the cwd the suite starts in is the only fixed point.
  function boardPageSource(): string {
    for (const candidate of ['src/routes/BoardPage.tsx', 'web/src/routes/BoardPage.tsx']) {
      const full = resolvePath(process.cwd(), candidate)
      if (existsSync(full)) return readFileSync(full, 'utf8').replace(/\/\/[^\n]*/g, '')
    }
    throw new Error(`BoardPage.tsx not found from ${process.cwd()}`)
  }

  function stubWakeLock(request: () => Promise<unknown>) {
    Object.defineProperty(window.navigator, 'wakeLock', { configurable: true, value: { request } })
    return () => Reflect.deleteProperty(window.navigator, 'wakeLock')
  }

  it('polls the snapshot endpoint and paints the live board', async () => {
    const feed = snapshotFeed(liveBoard(1))
    fakeFetch(url => feed.handle(url) ?? { json: {} })
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Mat 1' })).toBeInTheDocument())
    expect(within(screen.getByRole('region', { name: 'Scoreboard' })).getAllByText('Wins')).toHaveLength(2)
  })

  it('takes a screen wake lock, because a slept panel never recovers on its own', async () => {
    const request = vi.fn(async () => ({ addEventListener: vi.fn(), release: async () => {} }))
    const restore = stubWakeLock(request)
    try {
      const feed = snapshotFeed(liveBoard(1))
      fakeFetch(url => feed.handle(url) ?? { json: {} })
      render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
      await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
      await waitFor(() => expect(screen.queryByText('Screen may sleep')).not.toBeInTheDocument())
    } finally {
      restore()
    }
  })

  it('leans on the hook\'s own in-flight guard rather than keeping a second one', async () => {
    // The page asks on mount and again on every gesture, because Safari refuses the
    // request outside a user activation. Deduping those belongs in useWakeLock, which
    // also covers the visibilitychange re-acquire this page cannot see; a second guard
    // beside it was a second thing to keep true, and only one of them saw both callers.
    const request = vi.fn(() => new Promise(() => {}))
    const restore = stubWakeLock(request)
    try {
      const feed = snapshotFeed(liveBoard(1))
      fakeFetch(url => feed.handle(url) ?? { json: {} })
      render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
      await waitFor(() => expect(request).toHaveBeenCalled())
      window.dispatchEvent(new Event('pointerdown'))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
    // The behaviour above holds with either guard, so the duplicate is checked for
    // directly: the page asks, and nothing on the page decides whether to.
    expect(boardPageSource()).not.toMatch(/pending|inFlight|requesting/i)
  })

  it('says the screen may sleep when the panel refuses the lock', async () => {
    const request = vi.fn(async () => { throw new Error('not allowed') })
    const restore = stubWakeLock(request)
    try {
      const feed = snapshotFeed(liveBoard(1))
      fakeFetch(url => feed.handle(url) ?? { json: {} })
      render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/board/1'] })} />)
      expect(await screen.findByText('Screen may sleep')).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
