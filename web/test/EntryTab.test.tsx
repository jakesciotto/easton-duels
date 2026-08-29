import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EntryTab } from '@/routes/event/EntryTab'
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
  id, eventId: 7, matId: null, orderIndex: id, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200, status: 'pending',
  winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null, ...over,
})
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran')],
  rulesets: [], mats: [],
  matches: [match(1, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }), match(2, { athleteAId: 101, athleteBId: 201 })],
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><EntryTab detail={detail} /></QueryClientProvider>)
}

describe('EntryTab', () => {
  it('posts a new entry with the default winner and clears the form', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: {}, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Boulder kid'), '101')
    await user.selectOptions(screen.getByLabelText('Denver kid'), '201')
    await user.type(screen.getByLabelText('Boulder points'), '5')
    await user.type(screen.getByLabelText('Denver points'), '2')
    expect(screen.getByRole('button', { name: /Ava Park wins/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('On points')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save result' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/entries')).toBe(true))
    const posted = f.body(f.calls.findIndex(c => c.url === '/api/events/7/entries'))
    expect(posted).toMatchObject({ athleteAId: 101, athleteBId: 201, pointsA: 5, pointsB: 2, winnerAthleteId: 101, winType: 'points' })
    expect(posted.entryId).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    await vi.waitFor(() => expect(screen.getByLabelText('Boulder points')).toHaveValue(null))
    expect(screen.getByText(/Saved/)).toBeInTheDocument()
  })

  it('blocks save on a tie until a winner is picked, then sends a decision', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: {}, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Boulder kid'), '100')
    await user.selectOptions(screen.getByLabelText('Denver kid'), '200')
    await user.type(screen.getByLabelText('Boulder points'), '2')
    await user.type(screen.getByLabelText('Denver points'), '2')
    expect(screen.getByRole('button', { name: 'Save result' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Olivia Kim wins/ }))
    await user.click(screen.getByRole('button', { name: 'Save result' }))
    await vi.waitFor(() => expect(f.calls.length).toBeGreaterThan(0))
    expect(f.body(0)).toMatchObject({ winnerAthleteId: 200, winType: 'decision' })
  })

  it('lists results newest first, loads one for editing, and posts the correction', async () => {
    const f = fakeFetch(() => ({ json: { match: {}, version: 2 } }))
    mount()
    const user = userEvent.setup()
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getByText(/Mateo Rivera/)).toBeInTheDocument()
    await user.click(within(results).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Boulder points')).toHaveValue(4)
    await user.clear(screen.getByLabelText('Denver points'))
    await user.type(screen.getByLabelText('Denver points'), '4')
    await user.click(screen.getByRole('button', { name: /Olivia Kim wins/ }))
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/1/entry')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/1/entry'))).toMatchObject({ pointsA: 4, pointsB: 4, winnerAthleteId: 200, winType: 'decision' })
  })

  it('offers pending pairs and a start banner in setup', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(screen.getByLabelText('Boulder kid')).toHaveValue('101')
    expect(screen.getByLabelText('Denver kid')).toHaveValue('201')
    await user.click(screen.getByRole('button', { name: 'Start event' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7' && c.init?.method === 'PATCH')).toBe(true))
  })
})
