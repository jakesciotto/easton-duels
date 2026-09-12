import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TEAM_COLORS, TEAM_COLOR_KEYS, type EventMode, type EventStatus, type MatView, type MatchView, type Snapshot } from '@shared/types'
import { routes } from '@/router'
import { Board, FIRST_CONTACT_MS, NOTE_NO_CONTACT } from '@/routes/board/Board'
import { RESULTS_EMPTY } from '@/routes/board/ResultsBand'
import { POLL_CLOCK_RUNNING_MS, POLL_DEADLINE_MIN_MS } from '@/lib/pollInterval'
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

function event(status: EventStatus, mode: EventMode, matCount = 1): Snapshot['event'] {
  return { id: 1, name: 'Fall Duels', date: '2026-10-03', status, mode, matCount, contact: null, certifiedAt: null, far: null }
}

// Which composition the board paints is the event's stored mode, so every board fixture
// states the mode it is a fixture of rather than inheriting one from the sample.
function atMode(snapshot: Snapshot, mode: EventMode): Snapshot {
  return { ...snapshot, event: { ...snapshot.event, mode } }
}

function liveBoard(count: number, over: Partial<Snapshot> = {}): Snapshot {
  const mats = Array.from({ length: count }, (_, i) =>
    mat(i + 1, { current: pair(100 + i, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), bound: true }))
  return atMode(sampleSnapshot({ mats, matches: mats.map(m => m.current!), ...over }), 'live')
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
    // 6.15 is exact: the two rows an event holds at its minimum are already in their
    // final positions and ONLY their wins numerals are skeletons.
    expect(container.querySelectorAll('.lb-row')).toHaveLength(2)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2)
    for (const box of container.querySelectorAll('.lb-edge, .lb-rank, .lb-name')) {
      expect(box).not.toHaveAttribute('data-slot', 'skeleton')
    }
    expect(screen.queryByText('Wins')).not.toBeInTheDocument()
    // The points box is the same slot the first snapshot renders into, so its arrival
    // moves nothing.
    expect(container.querySelectorAll('.lb-pts-n')).toHaveLength(2)
  })

  it('is the data entry panel when the event is run from the desk', () => {
    const done = (id: number, endedAt: string) => pair(id, 'Ava Park', 'Sofia Diaz', {
      status: 'done', endedAt, result: { winnerAthleteId: 100, winType: 'submission' },
    })
    const matches = [1, 2, 3, 4, 5].map(i => done(i, `2026-10-03T16:0${i}:00.000Z`))
    const snapshot = atMode(sampleSnapshot({ mats: [mat(1)], matches }), 'entry')
    const { container } = render(<Board snapshot={snapshot} connected />)

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

  it('stays on the mat ledger between bouts, bound or not', () => {
    // Held results are derived from transitions this client watched and a binding is
    // dropped between bouts, so both are empty on the first snapshot after a reload.
    // Four bouts ending together used to repaint the whole board as a Final Score panel
    // until the next one started. The mode says which board this is; nothing else does.
    const done = pair(1, 'Ava Park', 'Sofia Diaz', {
      status: 'done', endedAt: '2026-10-03T16:01:00.000Z', result: { winnerAthleteId: 100, winType: 'submission' },
    })
    for (const bound of [true, false]) {
      const snapshot = atMode(sampleSnapshot({
        mats: [1, 2, 3, 4].map(n => mat(n, { bound })),
        matches: [done],
      }), 'live')
      const { container, unmount } = render(<Board snapshot={snapshot} connected />)
      expect(safe(container), String(bound)).toHaveAttribute('data-comp', 'mats')
      expect(screen.getAllByRole('region', { name: /^Mat / })).toHaveLength(4)
      // G05: and every one of those four rows says something. A mat with nothing on it
      // and nothing left to call used to render the gutter and the numeral alone, so a
      // reload left the room reading four blank rows for the rest of the afternoon.
      // M10: mat 1 carried the finished match, so it is complete. The other three never
      // carried anything, and a mat nothing was ever put on is empty, not finished.
      expect(row('Mat 1'), String(bound)).toHaveTextContent('Mat 1 complete')
      for (const n of [2, 3, 4]) {
        expect(row(`Mat ${n}`), String(bound)).toHaveTextContent(`Nothing on mat ${n} yet`)
      }
      unmount()
    }
  })

  /**
   * G05. The note is the row's own, so a mat still holding a pair does not get it, and a
   * mat with a queue behind it shows the pair rather than a completion it has not reached.
   */
  it('says complete only on the mat that has nothing left', () => {
    const live = pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING })
    const next = pair(11, 'Kai Nakamura', 'Rosa Oliveira', { status: 'pending', matId: 2 })
    // Mat 3 carried a match earlier in the afternoon, so with nothing left it is complete.
    const finished = pair(12, 'Ava Park', 'Sofia Diaz', {
      status: 'done', matId: 3, endedAt: '2026-10-03T15:50:00.000Z', result: { winnerAthleteId: 100, winType: 'points' },
    })
    const snapshot = atMode(sampleSnapshot({
      mats: [
        mat(1, { current: live, bound: true }),
        mat(2, { onDeck: [next] }),
        mat(3, {}),
      ],
      matches: [live, next, finished],
    }), 'live')
    render(<Board snapshot={snapshot} connected />)
    expect(row('Mat 1')).not.toHaveTextContent('complete')
    expect(row('Mat 2')).not.toHaveTextContent('complete')
    expect(row('Mat 2')).toHaveTextContent('Kai')
    expect(row('Mat 3')).toHaveTextContent('Mat 3 complete')
  })

  it('composes one snapshot two ways, because the mode belongs to the event', () => {
    // A tablet somebody left bound to mat 1 is not the event changing shape. The desk
    // board reads its results and the live board reads its mat, off the same data.
    const done = pair(1, 'Ava Park', 'Sofia Diaz', {
      status: 'done', endedAt: '2026-10-03T16:01:00.000Z', result: { winnerAthleteId: 100, winType: 'submission' },
    })
    const live = pair(2, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING })
    const snapshot = sampleSnapshot({
      mats: [mat(1, { current: live, bound: true })],
      matches: [done, live],
    })

    const desk = render(<Board snapshot={atMode(snapshot, 'entry')} connected />)
    expect(safe(desk.container)).toHaveAttribute('data-comp', 'entry')
    expect(screen.queryByRole('region', { name: 'Mat 1' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: /^Result/ })).toHaveLength(1)
    desk.unmount()

    const mats = render(<Board snapshot={atMode(snapshot, 'live')} connected />)
    expect(safe(mats.container)).toHaveAttribute('data-comp', 'mats')
    expect(screen.getByRole('region', { name: 'Mat 1' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Result/ })).not.toBeInTheDocument()
  })

  it('shows what is first up on each mat while the event is still in setup', () => {
    const queue = (m: number) => [1, 2, 3, 4].map(i =>
      pair(m * 10 + i, `Kai${m}${i} Nakamura`, `Rosa${m}${i} Oliveira`, { status: 'pending' }))
    const snapshot = sampleSnapshot({
      event: event('setup', 'live', 2),
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
      event: event('setup', 'live'),
      mats: [mat(1, { onDeck: [], bound: true })],
      matches: [],
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-comp', 'setup')
    expect(screen.getByText('Mat 1 first up')).toBeInTheDocument()
    expect(screen.getByText('Not drawn yet')).toBeInTheDocument()
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(0)
  })

  /**
   * G27. Both modes open on the setup composition, and in entry mode no mat runs anything,
   * so "Mat 2 first up" heads an arrangement the room never sees. The head becomes one
   * line over the whole band and the columns carry the event's own running order.
   */
  it('heads the desk event with the running order and no mat labels', () => {
    const order = [1, 2, 3, 4, 5].map(i =>
      pair(i, `Kai${i} Nakamura`, `Rosa${i} Oliveira`, { status: 'pending', orderIndex: 5 - i }))
    const snapshot = sampleSnapshot({
      event: event('setup', 'entry', 2),
      mats: [mat(1), mat(2)],
      matches: order,
    })
    const { container } = render(<Board snapshot={snapshot} connected />)

    expect(safe(container)).toHaveAttribute('data-comp', 'setup')
    expect(screen.getByText('Up next')).toBeInTheDocument()
    expect(screen.queryByText('Mat 1 first up')).not.toBeInTheDocument()
    expect(screen.queryByText('Mat 2 first up')).not.toBeInTheDocument()

    // Two columns of three, filled down before across, and the order is the event's own
    // rather than each mat's: orderIndex 0 leads column one and column two carries the
    // tail, so reading the board down and then across is reading the running order.
    const lines = Array.from(container.querySelectorAll('.b-next-line'))
    expect(lines).toHaveLength(5)
    expect(lines[0]).toHaveTextContent('Kai5')
    expect(lines[2]).toHaveTextContent('Kai3')
    expect(lines[3]).toHaveTextContent('Kai2')
  })

  it('never opens a column it has nothing to put in', () => {
    const order = [pair(1, 'Kai1 Nakamura', 'Rosa1 Oliveira', { status: 'pending', orderIndex: 0 })]
    const snapshot = sampleSnapshot({
      event: event('setup', 'entry', 4),
      mats: [mat(1), mat(2), mat(3), mat(4)],
      matches: order,
    })
    const { container } = render(<Board snapshot={snapshot} connected />)
    expect(container.querySelectorAll('.b-order > .b-panel')).toHaveLength(1)
  })

  it('says the desk event is not drawn yet rather than heading an empty band', () => {
    const snapshot = sampleSnapshot({
      event: event('setup', 'entry', 2),
      mats: [mat(1), mat(2)],
      matches: [],
    })
    render(<Board snapshot={snapshot} connected />)
    expect(screen.getByText('Up next')).toBeInTheDocument()
    expect(screen.getByText('Not drawn yet')).toBeInTheDocument()
  })

  it('keeps the mat heads on an event the mats score', () => {
    const queue = [1, 2].map(i => pair(i, `Kai${i} Nakamura`, `Rosa${i} Oliveira`, { status: 'pending' }))
    const snapshot = sampleSnapshot({
      event: event('setup', 'live', 1),
      mats: [mat(1, { onDeck: queue, bound: true })],
      matches: queue,
    })
    render(<Board snapshot={snapshot} connected />)
    expect(screen.getByText('Mat 1 first up')).toBeInTheDocument()
    expect(screen.queryByText('Up next')).not.toBeInTheDocument()
  })

  /**
   * G34 / 7.3. The row carried one gutter, reserved for the live cue, so only position
   * said whose side is whose. Each competitor line now carries its own team edge, painted
   * from the snapshot's own teams so the row can never show a colour the hero does not.
   */
  it('paints a team edge at each end of a live mat row', () => {
    const { container } = render(<Board snapshot={liveBoard(1)} connected />)
    const edges = Array.from(row('Mat 1').querySelectorAll('.b-edge')) as HTMLElement[]
    expect(edges).toHaveLength(2)
    expect(edges[0].className).toContain('b-edge-a')
    expect(edges[1].className).toContain('b-edge-b')
    expect(edges[0].style.getPropertyValue('--team')).toBe(TEAM_COLORS.red)
    expect(edges[1].style.getPropertyValue('--team')).toBe(TEAM_COLORS.blue)
    // The live gutter is still its own element, and it is still the leading one.
    expect(container.querySelectorAll('.b-gut').length).toBeGreaterThan(0)
  })

  it('paints a team edge on every desk result row', () => {
    const done = pair(1, 'Mateo Rivera', 'Lucas Ferreira', {
      status: 'done', result: { winnerAthleteId: 100, winType: 'points' },
    })
    const snapshot = sampleSnapshot({
      event: event('live', 'entry'),
      mats: [],
      matches: [done],
    })
    render(<Board snapshot={snapshot} connected />)
    const result = screen.getByRole('region', { name: 'Result 1' })
    expect(result.querySelectorAll('.b-edge')).toHaveLength(2)
  })

  it('draws no team edge on a row with no pair on it', () => {
    const snapshot = sampleSnapshot({
      event: event('live', 'live'),
      mats: [mat(1, { current: null, onDeck: [] })],
      matches: [],
    })
    render(<Board snapshot={snapshot} connected />)
    expect(row('Mat 1').querySelectorAll('.b-edge')).toHaveLength(0)
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
      event: event('done', 'live'),
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
    // The standings name the winner by the rank numeral and the lead tone on its row.
    const hero = screen.getByRole('region', { name: 'Scoreboard' })
    expect(within(hero).getByText('7').closest('.lb-row')).toHaveClass('lb-lead')
    expect(within(hero).getByText('5').closest('.lb-row')).not.toHaveClass('lb-lead')
  })

  // 6.15: one b3 line of its own under the summary, centred and quiet. It is not a note:
  // section 8 keeps the note's attend colour for a state that needs a person. Before
  // certification the line is absent; the board never says Final, uncertified.
  describe('the certified line', () => {
    const finished = (over: Partial<Snapshot['event']> = {}) => sampleSnapshot({
      event: { ...event('done', 'live'), ...over },
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 41 },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 33 },
      ],
      matches: [pair(1, 'Ava Park', 'Sofia Diaz', { status: 'done' })],
    })
    const certifiedAt = new Date(2026, 9, 3, 16, 12).toISOString()

    it('prints the signature and its time under the summary', () => {
      const { container } = render(<Board snapshot={finished({ status: 'certified', certifiedAt })} connected lastSuccessAt={Date.now()} />)
      expect(safe(container)).toHaveAttribute('data-comp', 'done')
      const line = container.querySelector('.b-sign')
      expect(line).toHaveTextContent('Final, certified at 4:12 pm')
      expect(within(line as HTMLElement).getByText('4:12 pm')).toHaveClass('b-sign-at')
    })

    // Section 8 reserves the note row for a state that needs a person. A signature needs
    // nobody, so it is never rendered as one, and it never shares that row's one line.
    it('is its own element and not a note, even when the board also has a fault to report', () => {
      const { container } = render(
        <Board snapshot={finished({ status: 'certified', certifiedAt })} connected lastSuccessAt={Date.now() - 10_500} screenMaySleep />,
      )
      const note = container.querySelector('.b-note') as HTMLElement
      expect(note).not.toBeNull()
      expect(note.textContent).not.toMatch(/certified/)
      expect(within(note).getByText('Screen may sleep')).toBeInTheDocument()

      const line = container.querySelector('.b-sign') as HTMLElement
      expect(line).toHaveTextContent('Final, certified at 4:12 pm')
      expect(line.parentElement).toBe(note.parentElement)
      // The words the room reads first are the ones that need somebody.
      expect(note.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('says nothing at all before an admin certifies', () => {
      render(<Board snapshot={finished()} connected lastSuccessAt={Date.now()} />)
      expect(screen.queryByText(/certified/)).not.toBeInTheDocument()
    })

    it('leaves the line off every composition but the final one', () => {
      render(<Board snapshot={{ ...liveBoard(1), event: { ...event('live', 'live'), certifiedAt } }} connected lastSuccessAt={Date.now()} />)
      expect(screen.queryByText(/certified/)).not.toBeInTheDocument()
    })
  })

  it('raises the stale bar when the poll stops landing', () => {
    const { container, rerender } = render(<Board snapshot={liveBoard(1)} connected />)
    expect(container.querySelector('.b-stale')).toBeNull()
    rerender(<Board snapshot={liveBoard(1)} connected={false} />)
    expect(container.querySelector('.b-stale')).not.toBeNull()
  })
})

// 7.1 and the approved mockup (frames 1, 2, 4 and 6A): one hero for every team count,
// a row per team in the order the server ranked them. The board never ranks: it draws
// `snapshot.leaderboard`, so the console, the Live tab and the television cannot
// disagree about who is winning.
describe('the leaderboard hero', () => {
  const NAMES = ['Ridgeline', 'Lakeside', 'Harbor Park', 'Cedar Ridge', 'Stonebrook', 'Fairview', 'Northgate', 'Wildflower']

  function standings(scores: [number, number][], over: Partial<Snapshot> = {}): Snapshot {
    const teams = scores.map(([wins, points], i) => ({
      id: i + 1, name: NAMES[i], color: TEAM_COLOR_KEYS[i], position: i, wins, points,
    }))
    return atMode(sampleSnapshot({ teams, mats: [mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), bound: true })], matches: [], ...over }), 'live')
  }

  function rows(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll('.lb-row')] as HTMLElement[]
  }
  function cell(row: HTMLElement, selector: string): string {
    return (row.querySelector(selector) as HTMLElement).textContent ?? ''
  }

  it('draws a row per team at two teams, where the halves used to be', () => {
    const { container } = render(<Board snapshot={standings([[12, 71], [10, 64]])} connected />)
    const drawn = rows(container)
    expect(drawn).toHaveLength(2)
    expect(drawn.map(r => cell(r, '.lb-rank'))).toEqual(['1', '2'])
    expect(drawn.map(r => cell(r, '.lb-name'))).toEqual(['Ridgeline', 'Lakeside'])
    expect(drawn.map(r => cell(r, '.lb-wins'))).toEqual(['12', '10'])
    expect(drawn.map(r => cell(r, '.lb-pts'))).toEqual(['71 pts', '64 pts'])
    // Pick 6: no three letter plate and no repeated label. The colour edge and the
    // full name carry identity, and "pts" alone keeps the pair unambiguous.
    expect(container.querySelector('.b-code')).toBeNull()
    expect(screen.queryByText('RID')).not.toBeInTheDocument()
    expect(screen.queryByText('Wins')).not.toBeInTheDocument()
    // The two-half hero is retired, so nothing on the stage carries its geometry.
    expect(container.querySelector('.b-hero')).toBeNull()
    expect(container.querySelector('.b-half')).toBeNull()
  })

  it('carries the team colour as a full height edge that costs no column', () => {
    const { container } = render(<Board snapshot={standings([[3, 9], [1, 4]])} connected />)
    const drawn = rows(container)
    expect(drawn.map(r => r.style.getPropertyValue('--team')))
      .toEqual([TEAM_COLORS[TEAM_COLOR_KEYS[0]], TEAM_COLORS[TEAM_COLOR_KEYS[1]]])
    // The edge paints that colour and is named nowhere: the row's own name says which
    // team this is, so the colour is decoration and never the only channel.
    for (const row of drawn) expect(row.querySelector('.lb-edge')).toHaveAttribute('aria-hidden')
  })

  it('ranks three teams and holds the mat band exactly where it was', () => {
    const { container } = render(<Board snapshot={standings([[7, 38], [5, 31], [5, 29]])} connected />)
    expect(rows(container).map(r => cell(r, '.lb-rank'))).toEqual(['1', '2', '3'])
    const layer = safe(container)
    // Frame 1: three rows still fit a 31cqh hero, so the band is byte for byte today's.
    expect(layer.style.getPropertyValue('--b-hero-n')).toBe('31')
    expect(layer.style.getPropertyValue('--lb-rows')).toBe('3')
    expect(layer.style.getPropertyValue('--b-band-n')).toBe('56')
    expect(within(row('Mat 1')).getByText(/^\d+:\d{2}$/)).toBeInTheDocument()
  })

  it('shares the numeral between tied teams and tones every one of them as the lead', () => {
    // Frame 2: both leaders print 1, the next team prints 3, and the tie is carried by
    // the tone on the figures, never by a background or a rule that would read as a win.
    const { container } = render(<Board snapshot={standings([[7, 38], [7, 38], [5, 29]])} connected />)
    const drawn = rows(container)
    expect(drawn.map(r => cell(r, '.lb-rank'))).toEqual(['1', '1', '3'])
    expect(drawn.map(r => r.classList.contains('lb-lead'))).toEqual([true, true, false])
  })

  it('orders a tie by the position the teams were added at, so a poll never reshuffles', () => {
    const { container } = render(<Board snapshot={standings([[2, 10], [4, 12], [4, 12]])} connected />)
    expect(rows(container).map(r => cell(r, '.lb-name'))).toEqual(['Lakeside', 'Harbor Park', 'Ridgeline'])
    expect(rows(container).map(r => cell(r, '.lb-rank'))).toEqual(['1', '1', '3'])
  })

  it('grows the hero and shrinks the band to one mat row at eight teams', () => {
    // Frame 6A: eight rows at the b3 floor, 78cqh of hero, a 3cqh gap and a 9cqh band.
    // What the room gives up is the rest of the band: no next line and no clock.
    const scores: [number, number][] = [[9, 51], [8, 47], [7, 44], [6, 38], [5, 33], [4, 26], [3, 19], [2, 14]]
    const queue = [pair(20, 'Ana Bravo', 'Nina Costa', { status: 'pending' })]
    const { container } = render(<Board snapshot={standings(scores, {
      mats: [mat(1, { current: pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING }), onDeck: queue, bound: true })],
    })} connected />)

    expect(rows(container)).toHaveLength(8)
    expect(rows(container).map(r => cell(r, '.lb-rank'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    const layer = safe(container)
    expect(layer.style.getPropertyValue('--b-hero-n')).toBe('78')
    expect(layer.style.getPropertyValue('--lb-rows')).toBe('8')
    expect(layer.style.getPropertyValue('--b-band-n')).toBe('9')
    expect(layer.style.getPropertyValue('--b-row-n')).toBe('9')
    expect(container.querySelectorAll('.b-panel')).toHaveLength(1)
    expect(container.querySelectorAll('.b-next-line')).toHaveLength(0)
    expect(within(row('Mat 1')).queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument()
    expect(row('Mat 1')).not.toHaveClass('b-row-clock')
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

  it('holds the team points figure in its own character slot at every value', () => {
    // 2.8: every number gets a fixed slot. This was the one figure on the board without
    // one, so a team going from 9 points to 11 grew its label box by a whole character
    // in one frame and shoved the word beside it sideways on a still hero.
    const withPoints = (points: number) => atMode(sampleSnapshot({
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 3, points },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 2, points: 7 },
      ],
    }), 'live')

    const { container, rerender } = render(<Board snapshot={withPoints(9)} connected />)
    const slots = () => [...container.querySelectorAll('.lb-pts-n')]
    expect(slots()).toHaveLength(2)
    // Only the digits are in the slot: " pts" inside it would size the box by the word.
    expect(slots()[0].textContent).toBe('9')

    rerender(<Board snapshot={withPoints(11)} connected />)
    expect(slots()[0].textContent).toBe('11')
    expect(screen.getAllByText(/pts/)).toHaveLength(2)
  })
})

describe('Board first contact', () => {
  afterEach(() => vi.useRealTimers())

  it('says it cannot reach the server when no poll has ever landed', () => {
    // The television opened before the laptop is up, or on the wrong network, or on an
    // event id that answers 404. Every note the board had was derived from a
    // lastSuccessAt, so this board sat on the cold start skeleton with no words at all.
    vi.useFakeTimers()
    render(<Board snapshot={null} connected={false} />)
    // A first poll in flight is the ordinary opening of every board. Saying anything
    // here would print a fault on every healthy start and then take the line back.
    expect(screen.queryByText(NOTE_NO_CONTACT)).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(FIRST_CONTACT_MS + 1000) })
    const note = screen.getByText(NOTE_NO_CONTACT)
    expect(note.parentElement).toHaveClass('b-note')
    // In the safe area where the room reads, not the letterbox margin outside it.
    expect(note.closest('.b-safe')).not.toBeNull()
  })

  it('stays silent while a genuine second attempt is still in flight', () => {
    // The poll aborts attempt one at POLL_DEADLINE_MIN_MS and schedules the next tick one
    // interval after that, so deadline + interval is the instant attempt two is
    // DISPATCHED. The old constant fired the note there, which on a congested network
    // told the room the server was unreachable while the second request was in the air.
    expect(FIRST_CONTACT_MS).toBeGreaterThanOrEqual(POLL_DEADLINE_MIN_MS * 2 + POLL_CLOCK_RUNNING_MS)

    vi.useFakeTimers()
    render(<Board snapshot={null} connected={false} />)
    act(() => { vi.advanceTimersByTime(POLL_DEADLINE_MIN_MS + POLL_CLOCK_RUNNING_MS + 500) })
    expect(screen.queryByText(NOTE_NO_CONTACT)).not.toBeInTheDocument()

    // Attempt two has now had its own whole deadline and settled nothing.
    act(() => { vi.advanceTimersByTime(POLL_DEADLINE_MIN_MS) })
    expect(screen.getByText(NOTE_NO_CONTACT)).toBeInTheDocument()
  })

  it('leaves a board that has heard from the server to the stale note', () => {
    vi.useFakeTimers()
    render(<Board snapshot={liveBoard(1)} connected={false} lastSuccessAt={Date.now()} />)
    act(() => { vi.advanceTimersByTime(FIRST_CONTACT_MS * 4) })

    expect(screen.queryByText(NOTE_NO_CONTACT)).not.toBeInTheDocument()
    expect(screen.getByText(/^Not updating \d+s$/)).toBeInTheDocument()
  })

  it('never faults a board whose poll is landing but is not timestamped', () => {
    // The note is two facts, not one: nothing has arrived AND the poll is not landing.
    // A caller that feeds the board without a lastSuccessAt is not a broken television.
    vi.useFakeTimers()
    render(<Board snapshot={liveBoard(1)} connected />)
    act(() => { vi.advanceTimersByTime(FIRST_CONTACT_MS * 4) })
    expect(screen.queryByText(NOTE_NO_CONTACT)).not.toBeInTheDocument()
  })
})

/**
 * G16. A finished row read its tones off the scores, so `mine >= theirs` gave both sides
 * the lead tone at equal scores and a submission at 0 to 0 showed no winner at all, which
 * is the one thing a result row exists to say. It reads the recorded winner instead.
 */
describe('Board result tones', () => {
  afterEach(() => vi.useRealTimers())

  // Level at 0 to 0, which is exactly the case the score based tones could not read.
  // Mateo is side a (athlete 100) and Lucas is side b (athlete 200).
  const level = pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING })
  const ended = (winnerAthleteId: number): MatchView => ({
    ...level,
    status: 'done',
    clock: PAUSED,
    endedAt: '2026-10-03T16:01:00.000Z',
    result: { winnerAthleteId, winType: 'submission' },
  })
  const nameEl = (container: HTMLElement, first: string) =>
    within(container).getByText(first).closest('.b-name') as HTMLElement
  const scoreEl = (container: HTMLElement, cls: string) =>
    container.querySelector(`.${cls}`) as HTMLElement

  /**
   * The settle timer treats every id already on the first snapshot as settled, so a
   * reload does not flash old results. The bout therefore has to actually finish across
   * two renders for the ten second hold to be the state under test.
   */
  const holding = (winnerAthleteId: number) => {
    const finished = ended(winnerAthleteId)
    const before = atMode(sampleSnapshot({ mats: [mat(1, { current: level, bound: true })], matches: [level] }), 'live')
    const after = atMode(sampleSnapshot({ mats: [mat(1, { current: finished, bound: true })], matches: [finished] }), 'live')
    const view = render(<Board snapshot={before} connected />)
    view.rerender(<Board snapshot={after} connected />)
    return { ...view, after }
  }

  // 7.5 keeps --fig-lead and --fig-trail on the score display, so the figures name the
  // winner during the hold and the names stay at the row's own tone.
  it('names the winner at 0 to 0 before the row settles', () => {
    vi.useFakeTimers()
    holding(100)
    const r = row('Mat 1')
    expect(r).not.toHaveClass('b-row-settled')
    expect(nameEl(r, 'Mateo').className).not.toMatch(/b-fade|b-lead|b-trail/)
    expect(nameEl(r, 'Lucas').className).not.toMatch(/b-fade|b-lead|b-trail/)
    expect(scoreEl(r, 'b-score-a')).toHaveClass('b-lead')
    expect(scoreEl(r, 'b-score-b')).toHaveClass('b-trail')
  })

  it('follows the winner to the other side of the row', () => {
    vi.useFakeTimers()
    holding(200)
    const r = row('Mat 1')
    expect(scoreEl(r, 'b-score-a')).toHaveClass('b-trail')
    expect(scoreEl(r, 'b-score-b')).toHaveClass('b-lead')
  })

  // 6.15 keeps the result on the board and 3.4 forbids anything below --gray-10, so the
  // settled row stays quiet and still says who won: the loser takes one step down.
  it('keeps the winner readable after the ten second settle, one step apart', () => {
    vi.useFakeTimers()
    const { rerender, after } = holding(100)
    vi.advanceTimersByTime(11_000)
    rerender(<Board snapshot={after} connected />)

    const r = row('Mat 1')
    expect(r).toHaveClass('b-row-settled')
    // The winner carries no tone class and takes the settled row's own --gray-11.
    expect(nameEl(r, 'Mateo').className).not.toMatch(/b-fade|b-lead|b-trail/)
    expect(scoreEl(r, 'b-score-a').className).not.toMatch(/b-fade|b-lead|b-trail/)
    expect(nameEl(r, 'Lucas')).toHaveClass('b-fade')
    expect(scoreEl(r, 'b-score-b')).toHaveClass('b-fade')
  })

  it('reads a live row by score, not by a winner it does not have yet', () => {
    const live = pair(10, 'Mateo Rivera', 'Lucas Ferreira', { clock: RUNNING })
    const scored = { ...live, a: { ...live.a, score: 2 }, b: { ...live.b, score: 6 } }
    render(<Board snapshot={atMode(sampleSnapshot({
      mats: [mat(1, { current: scored, bound: true })],
      matches: [scored],
    }), 'live')} connected />)
    const r = row('Mat 1')
    expect(scoreEl(r, 'b-score-a')).toHaveClass('b-trail')
    expect(scoreEl(r, 'b-score-b')).toHaveClass('b-lead')
    expect(nameEl(r, 'Mateo').className).not.toMatch(/b-fade|b-lead|b-trail/)
    expect(nameEl(r, 'Lucas').className).not.toMatch(/b-fade|b-lead|b-trail/)
  })

  // The desk board is the composition the pilot runs, and a reloaded one is settled from
  // its first paint, so the loser stepping down is the only thing naming the winner there.
  it('paints the same winner on the desk composition', () => {
    render(<Board snapshot={atMode(sampleSnapshot({
      mats: [mat(1)],
      matches: [ended(200)],
    }), 'entry')} connected />)
    const r = screen.getByRole('region', { name: 'Result 1' }).querySelector('.b-row') as HTMLElement
    expect(r).toHaveClass('b-row-settled')
    expect(nameEl(r, 'Mateo')).toHaveClass('b-fade')
    expect(nameEl(r, 'Lucas').className).not.toMatch(/b-fade/)
  })
})

/**
 * G26. Between Start and the first result the desk band held nothing at all, so a 55 inch
 * screen in front of a full gym carried a hero, a zero, and an empty half.
 */
describe('Board data entry empty band', () => {
  it('says what the room is waiting for until the first result lands', () => {
    const { container } = render(<Board snapshot={atMode(sampleSnapshot({ mats: [mat(1)], matches: [] }), 'entry')} connected />)
    expect(safe(container)).toHaveAttribute('data-comp', 'entry')
    expect(screen.getByText(RESULTS_EMPTY)).toBeInTheDocument()
    expect(screen.getByText(/Results entered:/)).toHaveTextContent('Results entered: 0')
  })

  it('drops the line the moment a result is on the board', () => {
    const done = pair(1, 'Ava Park', 'Sofia Diaz', {
      status: 'done', endedAt: '2026-10-03T16:01:00.000Z', result: { winnerAthleteId: 100, winType: 'submission' },
    })
    render(<Board snapshot={atMode(sampleSnapshot({ mats: [mat(1)], matches: [done] }), 'entry')} connected />)
    expect(screen.queryByText(RESULTS_EMPTY)).not.toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: /^Result/ })).toHaveLength(1)
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
    expect(within(screen.getByRole('region', { name: 'Scoreboard' })).getAllByText(/pts/)).toHaveLength(2)
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
