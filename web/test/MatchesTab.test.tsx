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
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran'), kid(202, 2, 'Kai', 'Wong')],
  rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
  mats: [{ id: 1, eventId: 7, number: 1, currentMatchId: null }, { id: 2, eventId: 7, number: 2, currentMatchId: null }],
  matches: [match(1), match(2, { athleteAId: 101, athleteBId: 201, matId: 2, status: 'done', winnerAthleteId: 101, winType: 'points' })],
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MatchesTab detail={detail} /></QueryClientProvider>)
}

describe('MatchesTab', () => {
  it('renders rows, locks done rows, lists unpaired kids, and generates', async () => {
    // Fixture already has a pending match, so the generate button reads
    // "Regenerate" (see task-8-report.md for why this differs from the brief's literal test).
    const f = fakeFetch(() => ({ json: { created: 2, unpairedA: [], unpairedB: [202] } }))
    mount()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('ERP 6.1 vs 5.8')).toBeInTheDocument()
    expect(within(rows[1]).getByText('done')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Unpaired' })).toHaveTextContent('Kai Wong')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Regenerate' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/matches/generate')).toBe(true))
    expect(await screen.findByText(/2 matches created/)).toBeInTheDocument()
  })

  it('swaps a kid through the picker and moves a row down', async () => {
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
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/7/matches/reorder'))).toEqual({ ids: [2, 1] })
  })
})
