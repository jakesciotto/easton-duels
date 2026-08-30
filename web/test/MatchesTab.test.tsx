import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MatchesTab } from '@/routes/event/MatchesTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch } from './fakes'

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
// Three matches: two pending (1, 2, adjacent in order) and one locked (3, done).
// This lets one fixture cover both the reorder-among-pending-only rules and the
// "locked rows stay locked" rendering checks without juggling several fixtures.
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran'), kid(202, 2, 'Kai', 'Wong')],
  rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
  mats: [{ id: 1, eventId: 7, number: 1, currentMatchId: null }, { id: 2, eventId: 7, number: 2, currentMatchId: null }],
  matches: [
    match(1),
    match(2, { athleteAId: 101, athleteBId: 201, matId: 2, why: 'ERP 5.0 vs 4.8' }),
    match(3, { status: 'done', winnerAthleteId: 100, winType: 'points' }),
  ],
}

function mount(d: EventDetail = detail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MatchesTab detail={d} /></QueryClientProvider>)
}

describe('MatchesTab', () => {
  it('renders rows, locks done rows, lists unpaired kids, and generates after confirming', async () => {
    const f = fakeFetch(() => ({ json: { created: 2, unpairedA: [], unpairedB: [202] } }))
    mount()
    const user = userEvent.setup()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('ERP 6.1 vs 5.8')).toBeInTheDocument()
    expect(within(rows[2]).getByText('done')).toBeInTheDocument()
    expect(within(rows[2]).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Unpaired' })).toHaveTextContent('Kai Wong')
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    const dialog = await screen.findByRole('dialog')
    expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(true))
    expect(await screen.findByText(/2 matches created/)).toBeInTheDocument()
  })

  it('confirms before regenerating over existing pending matches, and cancel sends no request', async () => {
    const f = fakeFetch(() => ({ json: { created: 0, unpairedA: [], unpairedB: [] } }))
    mount()
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
    const f = fakeFetch(() => ({ json: { created: 3, unpairedA: [], unpairedB: [] } }))
    mount(noPending)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(true))
    expect(await screen.findByText(/3 matches created/)).toBeInTheDocument()
  })

  it('cancelling the confirm dialog clears a failed generate error from both the dialog and the banner', async () => {
    fakeFetch(() => ({ status: 500, json: { error: { code: 'internal', message: 'internal error' } } }))
    mount()
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

  it('swaps a kid through the picker and moves a pending row down, past the other pending row', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const rows = screen.getAllByRole('row').slice(1)
    await user.click(within(rows[0]).getByRole('button', { name: 'Olivia Kim' }))
    await user.click(await screen.findByRole('button', { name: 'Kai Wong' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/1')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/1'))).toEqual({ athleteBId: 202 })
    await user.click(within(rows[0]).getByRole('button', { name: 'Move down' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/reorder')).toBe(true))
    // Match 3 (done) keeps its slot at the end; only the two pending ids swap.
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/7/matches/reorder'))).toEqual({ ids: [2, 1, 3] })
  })

  it('disables Move down on the last pending row when its only neighbor down is locked', () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[1]).getByRole('button', { name: 'Move down' })).toBeDisabled()
    expect(within(rows[1]).getByRole('button', { name: 'Move up' })).toBeEnabled()
  })

  it('clears a stale mutation error once a different action succeeds', async () => {
    const f = fakeFetch(url => {
      if (url === '/api/events/7/matches/reorder') return { status: 422, json: { error: { code: 'validation', message: 'ids must be every match of the event exactly once' } } }
      return { json: {} }
    })
    mount()
    const user = userEvent.setup()
    const rows = screen.getAllByRole('row').slice(1)
    await user.click(within(rows[0]).getByRole('button', { name: 'Move down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ids must be every match of the event exactly once')
    await user.click(within(rows[1]).getByRole('button', { name: 'Delete match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/2' && c.init?.method === 'DELETE')).toBe(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
