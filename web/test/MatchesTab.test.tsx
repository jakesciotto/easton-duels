import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MatchView, Snapshot } from '@shared/types'
import { MatchesTab } from '@/routes/event/MatchesTab'
import { setAdminToken } from '@/lib/auth'
import { CERTIFIED_REFUSAL } from '@/lib/eventMode'
import { HISTORY_NOTE } from '@/routes/event/MatchHistorySheet'
import type { EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch, sampleMatch, sampleSnapshot, snapshotFeed, type Reply } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
})
const match = (id: number, over: Partial<MatchRow> = {}): MatchRow => ({
  id, eventId: 7, matId: 1, orderIndex: id, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200, status: 'pending',
  winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: 'ERP 6.1 vs 5.8', source: 'designed', ...over,
})
// Three matches: two pending (1, 2, adjacent in order) and one settled (3, done).
// This lets one fixture cover both the reorder-among-pending-only rules and the
// two-field split without juggling several fixtures.
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [
    { id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 },
    { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 },
    { id: 3, eventId: 7, name: 'Fernwood', color: 'teal', position: 2 },
  ],
  athletes: [
    kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'),
    kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran'), kid(202, 2, 'Kai', 'Wong'),
    kid(300, 3, 'Iris', 'Nolan'),
  ],
  rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
  mats: [{ id: 1, eventId: 7, number: 1, currentMatchId: null }, { id: 2, eventId: 7, number: 2, currentMatchId: null }],
  matches: [
    match(1),
    match(2, { athleteAId: 101, athleteBId: 201, matId: 2, why: 'ERP 5.0 vs 4.8' }),
    match(3, { status: 'done', winnerAthleteId: 100, winType: 'points' }),
  ],
  candidateCount: 0,
}

// Adds a 4th pending match that puts Mateo Rivera (100, already Team A in match 1)
// against Kai Wong, so Mateo is sitting in two pending matches at once.
const doubleBooked: EventDetail = {
  ...detail,
  matches: [...detail.matches, match(4, { athleteAId: 100, athleteBId: 202, matId: 1, why: null })],
}

const view = (id: number, over: Partial<MatchView> = {}): MatchView =>
  sampleMatch({ id, orderIndex: id, matId: 1, status: 'pending', ...over })

// The tab polls the snapshot the moment it mounts, so a test that does not care about the
// stream still has to answer that request. `{ version: 0 }` with no payload is what the
// server sends before anything has happened, and it leaves the rows coming from the detail.
// The Proposals panel mounts with the tab and reads its own list, so every fixture here
// answers that request with an empty one unless the test is about proposals.
const noStream = (url: string): Reply | undefined =>
  /\/snapshot(\?|$)/.test(url) ? { json: { version: 0 } }
    : url === '/api/events/7/proposals' ? { json: [] }
      : undefined

function mount(d: EventDetail = detail, handler: (url: string, init?: RequestInit) => Reply = () => ({ json: {} })) {
  const f = fakeFetch((url, init) => noStream(url) ?? handler(url, init))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MatchesTab detail={d} /></QueryClientProvider>)
  return f
}

function mountStreaming(snapshot: Snapshot, d: EventDetail = detail) {
  const feed = snapshotFeed(snapshot)
  const f = fakeFetch(url => feed.handle(url) ?? (url === '/api/events/7/proposals' ? { json: [] } : { json: {} }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MatchesTab detail={d} /></QueryClientProvider>)
  return { f, feed }
}

const pendingField = () => screen.getByRole('region', { name: 'Pending matches' })
const pendingRows = () => within(pendingField()).getAllByRole('row').slice(1)

// Every per-row control is named by its row, so the fixture's two queue rows name
// themselves here once rather than in eight places.
const M1 = 'match 1, Mateo Rivera versus Olivia Kim'
const M2 = 'match 2, Ava Park versus Noah Tran'

describe('MatchesTab', () => {
  it('splits the queue from the history and keeps the why chip', async () => {
    mount()
    const user = userEvent.setup()

    const rows = pendingRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('ERP 6.1 vs 5.8')).toBeInTheDocument()
    // Two competitors, two lines, one unit.
    expect(within(rows[0]).getByRole('button', { name: 'Swap Mateo Rivera, Ridgeline' })).toBeInTheDocument()
    expect(within(rows[0]).getByRole('button', { name: 'Swap Olivia Kim, Lakeside' })).toBeInTheDocument()
    // The done match is history: it never appears in the working field.
    expect(within(pendingField()).queryByText('beat')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show' }))
    const settled = within(screen.getByRole('region', { name: 'Settled matches' })).getAllByRole('row').slice(1)
    expect(settled).toHaveLength(1)
    expect(within(settled[0]).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(settled[0]).getByText('on points')).toBeInTheDocument()

    const free = screen.getByRole('region', { name: 'Without a match' })
    expect(free).toHaveTextContent('Kai Wong')
    // Every team has a column, the third one included, and each name carries its own press.
    expect(within(free).getByRole('button', { name: 'Add match for Iris Nolan' })).toBeInTheDocument()
    expect(within(free).getByText('Everybody here has a match.')).toBeInTheDocument()
  })

  it('swaps a competitor through the picker and moves a pending row down, past the other pending row', async () => {
    const f = mount()
    const user = userEvent.setup()
    await user.click(within(pendingRows()[0]).getByRole('button', { name: 'Swap Olivia Kim, Lakeside' }))
    await user.click(await screen.findByRole('button', { name: 'Kai Wong' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/1')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/1'))).toEqual({ athleteBId: 202 })
    await user.click(within(pendingRows()[0]).getByRole('button', { name: `Move ${M1} down` }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/reorder')).toBe(true))
    // Match 3 (done) keeps its slot at the end; only the two pending ids swap.
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/7/matches/reorder'))).toEqual({ ids: [2, 1, 3] })
  })

  it('disables Move down on the last pending row', () => {
    mount()
    const rows = pendingRows()
    expect(within(rows[1]).getByRole('button', { name: `Move ${M2} down` })).toBeDisabled()
    expect(within(rows[1]).getByRole('button', { name: `Move ${M2} up` })).toBeEnabled()
  })

  it('clears a stale mutation error once a different action succeeds', async () => {
    const f = mount(detail, url => {
      if (url === '/api/events/7/matches/reorder') return { status: 422, json: { error: { code: 'validation', message: 'ids must be every match of the event exactly once' } } }
      return { json: {} }
    })
    const user = userEvent.setup()
    await user.click(within(pendingRows()[0]).getByRole('button', { name: `Move ${M1} down` }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ids must be every match of the event exactly once')
    await user.click(within(pendingRows()[1]).getByRole('button', { name: `Delete ${M2}` }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/2' && c.init?.method === 'DELETE')).toBe(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns in the row when a pending match shares a competitor with another one', () => {
    mount(doubleBooked)
    const rows = pendingRows()
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Double booked')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Double booked')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('Double booked')).not.toBeInTheDocument()
  })

  it('highlights every row holding the competitor under the pointer', async () => {
    mount(doubleBooked)
    const rows = pendingRows()
    // Mateo is in match 1 and match 4, and not in match 2.
    await userEvent.setup().hover(within(rows[0]).getByRole('button', { name: 'Swap Mateo Rivera, Ridgeline' }))
    expect(rows[0]).toHaveAttribute('data-selected')
    expect(rows[2]).toHaveAttribute('data-selected')
    expect(rows[1]).not.toHaveAttribute('data-selected')
  })

  it('lifts a live match into the strip and refuses the controls whose target is live', async () => {
    const live = view(1, { status: 'live' })
    mountStreaming(sampleSnapshot({
      matches: [live, view(2), view(3, { status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })],
      mats: [{ id: 1, number: 1, current: live, onDeck: [view(2)], bound: true }],
    }))
    const strip = await screen.findByRole('region', { name: 'Live now' })
    expect(within(strip).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(strip).getByText('Live on mat 1')).toBeInTheDocument()
    // 2.1: --gray-9 is decoration only and never carries a word a person reads.
    expect(within(strip).getByText('vs').className).toContain('text-gray-10')
    expect(within(strip).getByRole('button', { name: `Delete ${M1}` })).toBeDisabled()

    // The live row has left the working queue, and the queue says which match is next.
    await vi.waitFor(() => expect(pendingRows()).toHaveLength(1))
    expect(within(pendingRows()[0]).getByText('Next on mat 2')).toBeInTheDocument()

  })

  it('keeps a skipped match in the queue with the reason printed', async () => {
    mountStreaming(sampleSnapshot({
      matches: [view(1), view(2, { lastSeq: 3 }), view(3, { status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
    }))
    // Match 2 is on mat 2 in the detail, which is where the skip sent it.
    expect(await screen.findByText('Skipped, moved to the end of mat 2')).toBeInTheDocument()
    expect(pendingRows()).toHaveLength(2)
  })

  it('snaps an out of range length back to the saved value and sends nothing', async () => {
    const f = mount()
    const user = userEvent.setup()
    const length = within(pendingRows()[0]).getByLabelText(`Length for ${M1}`)
    await user.clear(length)
    await user.type(length, '5')
    await user.tab()
    expect(length).toHaveValue('300')
    expect(f.calls.some(c => c.url === '/api/matches/1' && c.init?.method === 'PATCH')).toBe(false)
  })

  // 4.4: an arriving snapshot is held, not committed, while the operator is engaged, and
  // `data-dragging` on the tab root is the contract operatorEngaged() reads for a drag.
  it('marks the tab as engaged while a row is being dragged', async () => {
    mount()
    expect(document.querySelector('[data-dragging="true"]')).toBeNull()
    const grip = within(pendingRows()[0]).getByRole('button', { name: `Reorder ${M1}` })
    // jsdom has no PointerEvent, so the polyfill is a MouseEvent and drops isPrimary,
    // which is the first thing dnd-kit's pointer sensor checks.
    const down = createEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 })
    Object.defineProperty(down, 'isPrimary', { value: true })
    fireEvent(grip, down)
    fireEvent.pointerMove(document, { clientX: 0, clientY: 40 })
    expect(document.querySelector('[data-dragging="true"]')).not.toBeNull()
    fireEvent.pointerUp(document, { clientX: 0, clientY: 40 })
    expect(document.querySelector('[data-dragging="true"]')).toBeNull()
    // The sensor removes its capture-phase click swallower 50ms after the drop, and the
    // document outlives a test, so leaving early breaks whatever test clicks next.
    await new Promise(resolve => setTimeout(resolve, 60))
  })

  it('marks a double-booked competitor in the kid picker list', async () => {
    mount(doubleBooked)
    const user = userEvent.setup()
    await user.click(within(pendingRows()[1]).getByRole('button', { name: 'Swap Ava Park, Ridgeline' }))
    const dialog = await screen.findByRole('dialog')
    const mateoRow = within(dialog).getByRole('button', { name: 'Mateo Rivera' })
    expect(within(mateoRow).getByText('double-booked')).toBeInTheDocument()
    const avaRow = within(dialog).getByRole('button', { name: 'Ava Park' })
    expect(within(avaRow).queryByText('double-booked')).not.toBeInTheDocument()
  })

  it('marks the option and warns naming the competitor when adding a match by hand', async () => {
    // Liam Cruz is a fresh, unpaired Ridgeline competitor: contrast against Mateo, who is
    // already double-booked, to prove the marker only lands on the double-booked option.
    const withUnpaired: EventDetail = { ...doubleBooked, athletes: [...doubleBooked.athletes, kid(103, 1, 'Liam', 'Cruz')] }
    mount(withUnpaired)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add match' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText('First competitor'))
    expect(await screen.findByRole('option', { name: /Liam Cruz/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Mateo Rivera/ }))
    expect(within(dialog).getByText('Mateo Rivera is already in a pending match')).toBeInTheDocument()
  })

  // The elements list of a fourteen match queue was fourteen buttons called "Delete
  // match" and fourteen comboboxes called "Mat", in an order carrying no row identity,
  // so activating any one destroyed a match the user could not identify beforehand.
  it('names every per-row control by its own row, so no two rows share a control name', () => {
    mount()
    const rows = pendingRows()
    for (const [row, label] of [[rows[0], M1], [rows[1], M2]] as const) {
      expect(within(row).getByRole('button', { name: `Reorder ${label}` })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: `Move ${label} up` })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: `Move ${label} down` })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: `Delete ${label}` })).toBeInTheDocument()
      expect(within(row).getByLabelText(`Mat for ${label}`)).toBeInTheDocument()
      expect(within(row).getByLabelText(`Ruleset for ${label}`)).toBeInTheDocument()
      expect(within(row).getByLabelText(`Length for ${label}`)).toBeInTheDocument()
    }
    // The row-blind names are gone, and every name on the screen is unique.
    for (const blind of ['Delete match', 'Mat', 'Ruleset', 'Length', 'Move up', 'Move down', 'Drag to reorder']) {
      expect(screen.queryAllByLabelText(blind)).toHaveLength(0)
    }
    const labelled = Array.from(document.querySelectorAll('[aria-label]'))
      .map(el => el.getAttribute('aria-label')!)
      .filter(l => /^(Reorder|Move|Delete|Mat for|Ruleset for|Length for) match /.test(l))
    expect(labelled).toHaveLength(14)
    expect(new Set(labelled).size).toBe(labelled.length)
  })

  it('names the live strip delete by its match too, so several live mats do not collide', async () => {
    const live = view(1, { status: 'live' })
    mountStreaming(sampleSnapshot({
      matches: [live, view(2), view(3, { status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })],
      mats: [{ id: 1, number: 1, current: live, onDeck: [], bound: true }],
    }))
    const strip = await screen.findByRole('region', { name: 'Live now' })
    expect(within(strip).getByRole('button', { name: `Delete ${M1}` })).toBeInTheDocument()
    expect(within(strip).queryByRole('button', { name: 'Delete match' })).not.toBeInTheDocument()
  })

  // React writes a defaultValue once at mount and never again, so a length changed by a
  // second organizer never reached this cell and the operator set a
  // mat clock from a stale number.
  it('follows the served length when it changes after mount', () => {
    fakeFetch((url: string) => noStream(url) ?? { json: {} })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={qc}><MatchesTab detail={detail} /></QueryClientProvider>)
    const length = () => within(pendingRows()[0]).getByLabelText(`Length for ${M1}`)
    expect(length()).toHaveValue('300')

    const changed: EventDetail = { ...detail, matches: detail.matches.map(m => (m.id === 1 ? { ...m, lengthSec: 600 } : m)) }
    rerender(<QueryClientProvider client={qc}><MatchesTab detail={changed} /></QueryClientProvider>)
    expect(length()).toHaveValue('600')
  })

  it('drops a refused length edit instead of leaving the rejected value looking saved', async () => {
    mount(detail, (url, init) => (url === '/api/matches/1' && init?.method === 'PATCH'
      ? { status: 422, json: { error: { code: 'validation', message: 'lengthSec must be between 30 and 1800' } } }
      : { json: {} }))
    const user = userEvent.setup()
    const length = within(pendingRows()[0]).getByLabelText(`Length for ${M1}`)
    await user.clear(length)
    await user.type(length, '600')
    await user.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('lengthSec must be between 30 and 1800')
    await vi.waitFor(() => expect(length).toHaveValue('300'))
  })

  // 2.1: --gray-9 is decoration only and never carries a word a person reads. jsdom
  // applies no stylesheet, so the token is read off the element that carries the word.
  // A pairing crosses two of up to eight teams, so a side's plate comes off the roster
  // row rather than off the column the side happens to sit in.
  it('paints each side in the team that competitor is actually on', async () => {
    const crossed: EventDetail = {
      ...detail,
      // Match 1's B side moves to Fernwood, which is neither teams[0] nor teams[1].
      matches: [match(1, { athleteBId: 300 }), ...detail.matches.slice(1)],
    }
    mount(crossed)
    const row = within(pendingRows()[0])
    expect(row.getByRole('button', { name: 'Swap Iris Nolan, Fernwood' })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Swap Iris Nolan, Lakeside' })).not.toBeInTheDocument()
  })

  // The picker offers everybody the pairing can legally take, which is every team but
  // the one the competitor staying in the match is on.
  it('offers a third team when swapping a side', async () => {
    mount()
    const user = userEvent.setup()
    await user.click(within(pendingRows()[0]).getByRole('button', { name: 'Swap Olivia Kim, Lakeside' }))
    const picker = await screen.findByRole('dialog')
    expect(within(picker).getByRole('button', { name: 'Iris Nolan' })).toBeInTheDocument()
    expect(within(picker).queryByRole('button', { name: 'Ava Park' })).not.toBeInTheDocument()
  })

  // A swap is never refused for the pair it makes, so what the server noticed lands on
  // the row it changed rather than in a dialog that has already closed.
  it('prints what the server warned about a swapped pair on the row itself', async () => {
    mount(detail, (url, init) => (url === '/api/matches/1' && init?.method === 'PATCH'
      ? { json: { warnings: ['3 weight classes apart', 'Already met'] } }
      : { json: {} }))
    const user = userEvent.setup()
    await user.click(within(pendingRows()[0]).getByRole('button', { name: 'Swap Olivia Kim, Lakeside' }))
    await user.click(await screen.findByRole('button', { name: 'Iris Nolan' }))
    const row = within(pendingRows()[0])
    expect(await row.findByText('3 weight classes apart')).toBeInTheDocument()
    expect(row.getByText('Already met')).toBeInTheDocument()
  })

  it('opens the Add match dialog on the competitor whose row asked for it', async () => {
    mount()
    const user = userEvent.setup()
    await user.click(within(screen.getByRole('region', { name: 'Without a match' })).getByRole('button', { name: 'Add match for Iris Nolan' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('First competitor')).toHaveTextContent('Iris Nolan')
  })

  it('spends --gray-10, not the decoration grey, on the word between two competitors', async () => {
    mount()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show' }))
    const el = screen.getByText('beat')
    expect(el.className).toContain('text-gray-10')
    expect(el.className).not.toContain('text-gray-9')
  })
})

/**
 * G10. Two of this screen's columns exist for a tablet. In desk mode no clock ever
 * starts, so a per match length is a number the organizer can set and nothing will read,
 * and the "Live now" strip is a lane that can only ever be empty. The mat select stays:
 * the running order per mat is the whole reason matches are designed in desk mode.
 */
describe('MatchesTab in desk mode', () => {
  const entryDetail: EventDetail = { ...detail, event: { ...detail.event, mode: 'entry' } }
  const deskSnapshot = (over: Partial<Snapshot> = {}): Snapshot => {
    const base = sampleSnapshot({
      matches: [view(1), view(2), view(3, { status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
      ...over,
    })
    return { ...base, event: { ...base.event, mode: 'entry' } }
  }

  it('drops the clock length column and keeps the mat select', async () => {
    mountStreaming(deskSnapshot(), entryDetail)
    await vi.waitFor(() => expect(pendingRows().length).toBeGreaterThan(0))
    expect(screen.queryByText('Sec')).not.toBeInTheDocument()
    expect(within(pendingRows()[0]).queryByLabelText(`Length for ${M1}`)).not.toBeInTheDocument()
    expect(within(pendingRows()[0]).getByLabelText(`Mat for ${M1}`)).toBeInTheDocument()
  })

  it('keeps both columns when the mats are scoring', async () => {
    mountStreaming(sampleSnapshot({
      matches: [view(1), view(2), view(3, { status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
    }))
    await vi.waitFor(() => expect(pendingRows().length).toBeGreaterThan(0))
    expect(screen.getByText('Sec')).toBeInTheDocument()
    expect(within(pendingRows()[0]).getByLabelText(`Length for ${M1}`)).toBeInTheDocument()
  })

  it('drops the live strip, because nothing on a desk event is live', async () => {
    mountStreaming(deskSnapshot(), entryDetail)
    await vi.waitFor(() => expect(pendingRows().length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Live now' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Live on mat/)).not.toBeInTheDocument()
  })

  // One fact, one source: the organizer switches the event from a phone at the same desk
  // and nothing invalidates this browser's detail cache when they do.
  it('follows the stream when the detail cache still says the mats are scoring', async () => {
    const { feed } = mountStreaming(sampleSnapshot({
      matches: [view(1), view(2), view(3, { status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
    }))
    expect(await screen.findByText('Sec')).toBeInTheDocument()
    feed.push(deskSnapshot())
    await vi.waitFor(() => expect(screen.queryByText('Sec')).not.toBeInTheDocument(), { timeout: 6000 })
  })
})

// 6.8 keeps the settled field out of the work lane, and its rows carry the two things a
// record needs after the fact: what happened, and one way to change it.
describe('MatchesTab settled row actions', () => {
  const M3 = 'match 3, Mateo Rivera versus Olivia Kim'
  const openSettledMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Show' }))
    await user.click(screen.getByRole('button', { name: `${M3} actions` }))
  }

  it('opens the match history from the settled row', async () => {
    const f = mount(detail, url => (url.endsWith('/history') ? { json: [] } : { json: {} }))
    const user = userEvent.setup()
    await openSettledMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Match history' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(HISTORY_NOTE)
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/3/history')).toBe(true))
  })

  it('opens the one correction dialog from the settled row', async () => {
    mount()
    const user = userEvent.setup()
    await openSettledMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Edit result' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Edit result')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Ridgeline points')).toBeInTheDocument()
  })

  // Refuse rather than ask: a certified record cannot be corrected, so the control is
  // disabled rather than accepted and answered with a 409 a second later.
  it('refuses the correction on a certified event and keeps the history readable', async () => {
    const certified = sampleSnapshot({ event: { ...sampleSnapshot().event, id: 7, status: 'certified' }, mats: [], matches: [] })
    mountStreaming(certified, { ...detail, event: { ...detail.event, status: 'certified' } })
    const user = userEvent.setup()
    await openSettledMenu(user)
    expect(await screen.findByRole('menuitem', { name: 'Edit result' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Match history' })).not.toHaveAttribute('data-disabled')
  })

  it('says what to do when the server refuses a write on a certified event', async () => {
    mount(detail, url => (url.endsWith('/matches/1')
      ? { status: 409, json: { error: { code: 'match_state', message: 'event is certified' } } }
      : { json: {} }))
    const user = userEvent.setup()
    await user.click(within(pendingRows()[0]).getByRole('button', { name: `Delete ${M1}` }))
    expect(await screen.findByText(CERTIFIED_REFUSAL)).toBeInTheDocument()
  })
})

/**
 * 6.8: a certified event refuses rather than asks. Every control that would write is
 * dead before it is pressed, and the reason is printed beside them, rather than each one
 * being accepted and answered with a 409 a second later.
 */
describe('MatchesTab on a certified event', () => {
  const mountCertified = () => {
    const snapshot = sampleSnapshot({ event: { ...sampleSnapshot().event, id: 7, status: 'certified' }, mats: [], matches: [] })
    return mountStreaming(snapshot, { ...detail, event: { ...detail.event, status: 'certified' } })
  }

  // Two fields, two clusters of dead controls, so the reason is printed beside each one
  // rather than once at the top of a screen an organizer has to scroll.
  it('kills the toolbar and the panel, and prints the reason beside each', async () => {
    mountCertified()
    await vi.waitFor(() => expect(screen.getAllByText(CERTIFIED_REFUSAL)).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Add match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Propose matches' })).toBeDisabled()
  })

  it('kills every control on a pending row, the reorder handle included', async () => {
    mountCertified()
    await vi.waitFor(() => expect(screen.getAllByText(CERTIFIED_REFUSAL).length).toBeGreaterThan(0))
    const row = within(pendingRows()[0])
    for (const name of [`Reorder ${M1}`, `Move ${M1} up`, `Move ${M1} down`, `Delete ${M1}`]) {
      expect(row.getByRole('button', { name }), name).toBeDisabled()
    }
    expect(row.getByRole('combobox', { name: `Mat for ${M1}` })).toBeDisabled()
    expect(row.getByRole('combobox', { name: `Ruleset for ${M1}` })).toBeDisabled()
    expect(row.getByLabelText(`Length for ${M1}`)).toBeDisabled()
    // The competitor swap is a button on each side of the pair.
    expect(row.getByRole('button', { name: 'Swap Mateo Rivera, Ridgeline' })).toBeDisabled()
    expect(row.getByRole('button', { name: 'Swap Olivia Kim, Lakeside' })).toBeDisabled()
  })

  // The running order cannot be dragged into a new one. Two things stop it, the disabled
  // handle and the empty sensor list, and this asserts the outcome rather than either.
  it('cannot start a drag, and sends no new order', async () => {
    const { f } = mountCertified()
    await vi.waitFor(() => expect(screen.getAllByText(CERTIFIED_REFUSAL).length).toBeGreaterThan(0))
    const grip = within(pendingRows()[0]).getByRole('button', { name: `Reorder ${M1}` })
    const down = createEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 })
    Object.defineProperty(down, 'isPrimary', { value: true })
    fireEvent(grip, down)
    fireEvent.pointerMove(document, { clientX: 0, clientY: 40 })
    expect(document.querySelector('[data-dragging="true"]')).toBeNull()
    fireEvent.pointerUp(document, { clientX: 0, clientY: 40 })
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(f.calls.some(c => c.url.endsWith('/matches/reorder'))).toBe(false)
  })

  it('leaves every one of them alive while the event is still open', async () => {
    mountStreaming(sampleSnapshot({ event: { ...sampleSnapshot().event, id: 7, status: 'live' }, mats: [], matches: [] }))
    const row = within((await screen.findAllByRole('row')).find(r => within(r).queryByRole('button', { name: `Delete ${M1}` })) as HTMLElement)
    expect(row.getByRole('button', { name: `Delete ${M1}` })).toBeEnabled()
    expect(row.getByRole('button', { name: `Reorder ${M1}` })).toBeEnabled()
    expect(row.getByRole('combobox', { name: `Mat for ${M1}` })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add match' })).toBeEnabled()
    expect(screen.queryByText(CERTIFIED_REFUSAL)).not.toBeInTheDocument()
  })
})
