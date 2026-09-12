import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProposalsPanel } from '@/routes/event/ProposalsPanel'
import { setAdminToken } from '@/lib/auth'
import { CERTIFIED_REFUSAL } from '@/lib/eventMode'
import type { AthleteRow, EventDetail, Proposal, ProposalSide } from '@/lib/types'
import { fakeFetch, type Reply } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): AthleteRow => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 9, ageSource: 'manual', weightLbs: 58, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
})

// Three teams, because a proposal exists to pair across more than two of them.
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [
    { id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 },
    { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 },
    { id: 3, eventId: 7, name: 'Fernwood', color: 'teal', position: 2 },
  ],
  athletes: [
    kid(100, 1, 'Mateo', 'Alvarez'), kid(101, 1, 'Ava', 'Brandt'),
    kid(200, 2, 'Olivia', 'Castellano'), kid(201, 2, 'Noah', 'Delgado'),
    kid(300, 3, 'Kai', 'Espinoza'), kid(301, 3, 'Iris', 'Fontaine'),
  ],
  rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
  mats: [{ id: 11, eventId: 7, number: 1, currentMatchId: null }],
  matches: [],
  candidateCount: 0,
}

const side = (athleteId: number, teamId: number, firstName: string, lastName: string, over: Partial<ProposalSide> = {}): ProposalSide => ({
  athleteId, teamId, firstName, lastName, age: 9, weightLbs: 58, weightClass: '54 to 61 lbs', belt: 'grey', erp: null, ...over,
})

const proposal = (id: number, a: ProposalSide, b: ProposalSide, why: string): Proposal =>
  ({ id, eventId: 7, cost: 2, why, a, b })

const P1 = proposal(1, side(100, 1, 'Mateo', 'Alvarez'), side(200, 2, 'Olivia', 'Castellano'), 'same class, same age')
const P2 = proposal(2, side(101, 1, 'Ava', 'Brandt'), side(300, 3, 'Kai', 'Espinoza'), '1 class apart, 2 years apart')

// The panel reads one list and writes to it. The fixture holds that list so a confirm or
// a remove is answered by the shorter list the next refetch asks for, which is what moves
// a row off the screen.
function mount(start: Proposal[], handler: (url: string, init?: RequestInit) => Reply | undefined = () => undefined, certified = false) {
  let list = start
  const f = fakeFetch((url, init) => {
    const own = handler(url, init)
    if (own) return own
    if (url === '/api/events/7/proposals' && (init?.method ?? 'GET') === 'GET') return { json: list }
    if (url === '/api/events/7/proposals' && init?.method === 'POST') { list = [P1, P2]; return { json: list } }
    if (/^\/api\/proposals\/(\d+)\/confirm$/.test(url)) {
      list = list.filter(p => String(p.id) !== url.split('/')[3])
      return { status: 201, json: { match: { id: 55 } } }
    }
    if (url === '/api/events/7/proposals/confirm-all') { const created = list.length; list = []; return { status: 201, json: { created, skipped: 0 } } }
    if (/^\/api\/proposals\/\d+$/.test(url) && init?.method === 'DELETE') {
      list = list.filter(p => String(p.id) !== url.split('/')[3])
      return { status: 204 }
    }
    return { json: {} }
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><ProposalsPanel detail={detail} certified={certified} /></QueryClientProvider>)
  return f
}

const panel = () => screen.getByRole('region', { name: 'Proposals' })
const posted = (f: { calls: { url: string; init?: RequestInit }[] }, url: string) =>
  f.calls.filter(c => c.url === url && c.init?.method === 'POST').length

describe('ProposalsPanel', () => {
  it('offers the first press on an empty list and prints what the proposer came back with', async () => {
    const f = mount([])
    const user = userEvent.setup()
    expect(await screen.findByText('No proposals yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Propose matches' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Propose matches' }))
    await vi.waitFor(() => expect(posted(f, '/api/events/7/proposals')).toBe(1))
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('same class, same age')).toBeInTheDocument()
    // Age, weight class and belt travel with each side, because the organizer is judging
    // the pairing rather than looking two kids up on the roster tab.
    expect(rows[0]).toHaveTextContent('54 to 61 lbs')
    expect(rows[0]).toHaveTextContent('Grey')
    expect(await screen.findByText('2 proposals ready.')).toBeInTheDocument()
  })

  it('asks before a second press replaces the drafts that already exist', async () => {
    const f = mount([P1, P2])
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    expect(screen.queryByRole('button', { name: 'Propose matches' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Propose more' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Replace 2 proposals?')).toBeInTheDocument()
    expect(posted(f, '/api/events/7/proposals')).toBe(0)

    await user.click(within(dialog).getByRole('button', { name: 'Propose more' }))
    await vi.waitFor(() => expect(posted(f, '/api/events/7/proposals')).toBe(1))
  })

  it('leaves the drafts alone when the confirm is cancelled', async () => {
    const f = mount([P1])
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Propose more' }))
    await screen.findByText('Replace 1 proposal?')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(posted(f, '/api/events/7/proposals')).toBe(0)
  })

  it('confirms one row, which leaves the list for the running order', async () => {
    const f = mount([P1, P2])
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Confirm Mateo Alvarez versus Olivia Castellano' }))
    await vi.waitFor(() => expect(posted(f, '/api/proposals/1/confirm')).toBe(1))
    await vi.waitFor(() => expect(screen.queryByText('same class, same age')).not.toBeInTheDocument())
    expect(screen.getByText('1 class apart, 2 years apart')).toBeInTheDocument()
  })

  it('confirms the whole list in one press and says how many it made', async () => {
    const f = mount([P1, P2])
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Confirm all' }))
    await vi.waitFor(() => expect(posted(f, '/api/events/7/proposals/confirm-all')).toBe(1))
    expect(await screen.findByText('Confirmed 2.')).toBeInTheDocument()
    expect(await screen.findByText('No proposals yet.')).toBeInTheDocument()
  })

  // A kid can pick up a match between the proposer running and the organizer pressing
  // Confirm all, so the server leaves that draft standing and says how many it left.
  it('counts the drafts confirm all left in place, and keeps them on the screen', async () => {
    const f = mount([P1, P2], (url, init) => (url === '/api/events/7/proposals/confirm-all' && init?.method === 'POST'
      ? { status: 201, json: { created: 1, skipped: 1 } }
      : undefined))
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Confirm all' }))
    await vi.waitFor(() => expect(posted(f, '/api/events/7/proposals/confirm-all')).toBe(1))
    expect(await screen.findByText('Confirmed 1, skipped 1.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('swaps a side from the picker, which offers every team but the one staying in', async () => {
    const f = mount([P1], (url, init) => (url === '/api/proposals/1' && init?.method === 'PATCH'
      ? { json: { proposal: { ...P1, b: side(300, 3, 'Kai', 'Espinoza'), why: '2 classes apart' }, removed: [9], warnings: ['2 weight classes apart', 'Already met'] } }
      : undefined))
    const user = userEvent.setup()
    await screen.findByText('same class, same age')

    await user.click(screen.getByRole('button', { name: 'Swap Olivia Castellano, Lakeside' }))
    const picker = await screen.findByRole('dialog')
    // Mateo stays in, so nobody on Ridgeline can take the other side.
    expect(within(picker).queryByRole('button', { name: 'Ava Brandt' })).not.toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: 'Kai Espinoza' })).toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: 'Kai Espinoza' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/proposals/1' && c.init?.method === 'PATCH')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/proposals/1' && c.init?.method === 'PATCH'))).toEqual({ athleteBId: 300 })
    expect(await screen.findByText('2 weight classes apart')).toBeInTheDocument()
    expect(screen.getByText('Already met')).toBeInTheDocument()
    expect(screen.getByText('One other proposal was removed to free this competitor.')).toBeInTheDocument()
  })

  it('removes a row', async () => {
    const f = mount([P1, P2])
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Remove Mateo Alvarez versus Olivia Castellano' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/proposals/1' && c.init?.method === 'DELETE')).toBe(true))
    await vi.waitFor(() => expect(screen.queryByText('same class, same age')).not.toBeInTheDocument())
  })

  // A refused confirm belongs to the row it refused, not to a banner over the whole
  // panel: the row stays put so the organizer can swap or remove it instead.
  it('reports a refused confirm on the row it refused', async () => {
    mount([P1, P2], (url, init) => (url === '/api/proposals/1/confirm' && init?.method === 'POST'
      ? { status: 409, json: { error: { code: 'match_state', message: 'Ines Vantel already has a match' } } }
      : undefined))
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Confirm Mateo Alvarez versus Olivia Castellano' }))
    const row = (await screen.findAllByRole('listitem'))[0]
    expect(await within(row).findByText('Ines Vantel already has a match')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('reports the ruleset refusal the same way', async () => {
    mount([P1], (url, init) => (url === '/api/proposals/1/confirm' && init?.method === 'POST'
      ? { status: 409, json: { error: { code: 'match_state', message: 'this event has no ruleset' } } }
      : undefined))
    const user = userEvent.setup()
    await screen.findByText('same class, same age')
    await user.click(screen.getByRole('button', { name: 'Confirm Mateo Alvarez versus Olivia Castellano' }))
    const row = (await screen.findAllByRole('listitem'))[0]
    expect(await within(row).findByText('this event has no ruleset')).toBeInTheDocument()
  })

  // 6.8: a certified event refuses rather than asks, and the reason is printed once beside
  // the controls it kills rather than waiting for somebody to press one.
  it('kills every control on a certified event and prints why', async () => {
    mount([P1], () => undefined, true)
    await screen.findByText('same class, same age')
    expect(screen.getByRole('button', { name: 'Propose more' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm all' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm Mateo Alvarez versus Olivia Castellano' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Swap Mateo Alvarez, Ridgeline' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Mateo Alvarez versus Olivia Castellano' })).toBeDisabled()
    expect(within(panel()).getByText(CERTIFIED_REFUSAL)).toBeInTheDocument()
  })
})
