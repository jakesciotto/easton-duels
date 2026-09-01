import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MatchView, Snapshot } from '@shared/types'
import { MatchesTab } from '@/routes/event/MatchesTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch, sampleMatch, sampleSnapshot, snapshotFeed, type Reply } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
})
const match = (id: number, over: Partial<MatchRow> = {}): MatchRow => ({
  id, eventId: 7, matId: 1, orderIndex: id, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200, status: 'pending',
  winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: 'ERP 6.1 vs 5.8', ...over,
})
// Three matches: two pending (1, 2, adjacent in order) and one settled (3, done).
// This lets one fixture cover both the reorder-among-pending-only rules and the
// two-field split without juggling several fixtures.
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', mode: 'live', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran'), kid(202, 2, 'Kai', 'Wong')],
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
const noStream = (url: string): Reply | undefined =>
  /\/snapshot(\?|$)/.test(url) ? { json: { version: 0 } } : undefined

function mount(d: EventDetail = detail, handler: (url: string, init?: RequestInit) => Reply = () => ({ json: {} })) {
  const f = fakeFetch((url, init) => noStream(url) ?? handler(url, init))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MatchesTab detail={d} /></QueryClientProvider>)
  return f
}

function mountStreaming(snapshot: Snapshot, d: EventDetail = detail) {
  const feed = snapshotFeed(snapshot)
  const f = fakeFetch(url => feed.handle(url) ?? { json: {} })
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
  it('splits the queue from the history, keeps the why chip, and generates after confirming', async () => {
    const f = mount(detail, () => ({ json: { created: 2, unpairedA: [], unpairedB: [202] } }))
    const user = userEvent.setup()

    const rows = pendingRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('ERP 6.1 vs 5.8')).toBeInTheDocument()
    // Two competitors, two lines, one unit.
    expect(within(rows[0]).getByRole('button', { name: 'Mateo Rivera, Ridgeline' })).toBeInTheDocument()
    expect(within(rows[0]).getByRole('button', { name: 'Olivia Kim, Lakeside' })).toBeInTheDocument()
    // The done match is history: it never appears in the working field.
    expect(within(pendingField()).queryByText('beat')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show' }))
    const settled = within(screen.getByRole('region', { name: 'Settled matches' })).getAllByRole('row').slice(1)
    expect(settled).toHaveLength(1)
    expect(within(settled[0]).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(settled[0]).getByText('on points')).toBeInTheDocument()

    expect(screen.getByRole('region', { name: 'Unpaired' })).toHaveTextContent('Kai Wong')

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    const dialog = await screen.findByRole('dialog')
    expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(true))
    expect(await screen.findByText(/2 matches created/)).toBeInTheDocument()
  })

  it('states the figure Regenerate is about to discard, hand ordered rows included', async () => {
    const f = mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 pending matches will be replaced.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(within(pendingRows()[0]).getByRole('button', { name: `Move ${M1} down` }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/reorder')).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 pending matches will be replaced. 1 of them you reordered by hand.')).toBeInTheDocument()
  })

  it('confirms before regenerating over existing pending matches, and cancel sends no request', async () => {
    const f = mount(detail, () => ({ json: { created: 0, unpairedA: [], unpairedB: [] } }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(false)
  })

  it('generates immediately with no confirm dialog when there are no pending matches', async () => {
    const noPending: EventDetail = {
      ...detail,
      matches: detail.matches.map(m => ({ ...m, status: 'done', winnerAthleteId: m.athleteAId, winType: 'points' })),
    }
    const f = mount(noPending, () => ({ json: { created: 3, unpairedA: [], unpairedB: [] } }))
    const user = userEvent.setup()
    expect(within(pendingField()).getByText('No matches yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(true))
    expect(await screen.findByText(/3 matches created/)).toBeInTheDocument()
  })

  it('cancelling the confirm dialog clears a failed generate error from both the dialog and the banner', async () => {
    mount(detail, () => ({ status: 500, json: { error: { code: 'internal', message: 'internal error' } } }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('internal error')
    // Only the dialog's own alert is present while it's open, not a second copy in the outer banner.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('swaps a competitor through the picker and moves a pending row down, past the other pending row', async () => {
    const f = mount()
    const user = userEvent.setup()
    await user.click(within(pendingRows()[0]).getByRole('button', { name: 'Olivia Kim, Lakeside' }))
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
    await userEvent.setup().hover(within(rows[0]).getByRole('button', { name: 'Mateo Rivera, Ridgeline' }))
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
    expect(within(strip).getByRole('button', { name: `Delete ${M1}` })).toBeDisabled()

    // The live row has left the working queue, and the queue says which match is next.
    await vi.waitFor(() => expect(pendingRows()).toHaveLength(1))
    expect(within(pendingRows()[0]).getByText('Next on mat 2')).toBeInTheDocument()

    // Regenerate would delete the queue a running mat is about to call, so it refuses
    // rather than asking.
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    expect(screen.getAllByText('Live on mat 1').length).toBeGreaterThan(1)
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
    await user.click(within(pendingRows()[1]).getByRole('button', { name: 'Ava Park, Ridgeline' }))
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
    await user.click(within(dialog).getByLabelText('Ridgeline competitor'))
    expect(await screen.findByRole('option', { name: 'Liam Cruz' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Mateo Rivera (double-booked)' }))
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
  // second organizer or by a Regenerate never reached this cell and the operator set a
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
  it('spends --gray-10, not the decoration grey, on the words between two competitors', async () => {
    mount()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show' }))
    for (const word of ['vs', 'beat']) {
      const el = screen.getByText(word)
      expect(el.className, word).toContain('text-gray-10')
      expect(el.className, word).not.toContain('text-gray-9')
    }
  })
})
