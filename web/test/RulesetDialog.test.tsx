import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RulesetDialog } from '@/routes/event/RulesetDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow, RulesetRow } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const ruleset: RulesetRow = {
  id: 3, eventId: 7, name: 'Kids gi', defaultLengthSec: 300,
  actions: [{ key: 'takedown', label: 'Takedown', points: 2 }, { key: 'penalty', label: 'Penalty', points: -1 }],
  terminals: [{ key: 'submission', label: 'Submission', winType: 'submission' }],
}

const match = (id: number, status: MatchRow['status']): MatchRow => ({
  id, eventId: 7, matId: null, orderIndex: id, rulesetId: 3, lengthSec: 300, athleteAId: 1, athleteBId: 2,
  status, winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
})

function mount(matches: MatchRow[] = [], rs: RulesetRow | undefined = ruleset) {
  const detail: EventDetail = {
    event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
    teams: [], athletes: [], rulesets: [ruleset], mats: [], matches, candidateCount: 0,
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RulesetDialog detail={detail} open onOpenChange={() => {}} ruleset={rs} /></QueryClientProvider>)
}

describe('RulesetDialog', () => {
  it('authors the default length in the m:ss form the board renders and posts seconds', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Default length (m:ss)')
    expect(field).toHaveValue('5:00')
    await user.clear(field)
    await user.type(field, '300')
    expect(field).toHaveValue('3:00')
    await user.click(screen.getByRole('button', { name: 'Save ruleset' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/rulesets/3')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/rulesets/3')).defaultLengthSec).toBe(180)
  })

  it('will not commit a length the server would reject', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Default length (m:ss)')
    await user.clear(field)
    await user.type(field, '3100')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save ruleset' })).toBeDisabled()
  })

  it('prints a penalty with its sign in the same track as a positive value', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    const values = screen.getAllByLabelText('Action points').map(i => (i as HTMLInputElement).value)
    expect(values).toEqual(['+2', '-1'])
  })

  it('refuses to remove a word this event has already scored with, and says why', async () => {
    fakeFetch(() => ({ json: {} }))
    mount([match(1, 'done'), match(2, 'live'), match(3, 'pending')])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Remove Takedown' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Remove Submission' })).toBeDisabled()
    expect(within(dialog).getByText(/Used by 2 scored matches/)).toBeInTheDocument()
  })

  it('still removes a word while every match under the ruleset is pending', async () => {
    fakeFetch(() => ({ json: {} }))
    mount([match(3, 'pending')])
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove Penalty' }))
    expect(screen.getAllByLabelText('Action points')).toHaveLength(1)
  })
})
