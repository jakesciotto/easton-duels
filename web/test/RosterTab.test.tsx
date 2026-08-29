import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RosterTab } from '@/routes/event/RosterTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number | null, first: string, over: Partial<EventDetail['athletes'][number]> = {}): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: 'Kid', age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null, ...over,
})
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo'), kid(200, 2, 'Olivia'), kid(300, null, 'Noah', { age: null, ageSource: null }), kid(400, null, 'Zoe', { weightSource: 'leaderboard', erp: 5.2 })],
  rulesets: [], mats: [], matches: [],
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RosterTab detail={detail} /></QueryClientProvider>)
}

describe('RosterTab', () => {
  it('shows three columns with chips for missing and estimated data', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const a = screen.getByRole('region', { name: 'Boulder' })
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    expect(within(a).getByText('Mateo Kid')).toBeInTheDocument()
    expect(within(pool).getByText('Noah Kid')).toBeInTheDocument()
    expect(within(pool).getAllByText('missing age')).toHaveLength(1)
    expect(within(pool).getByText('estimated')).toBeInTheDocument()
    expect(within(pool).getByText('ERP 5.2')).toBeInTheDocument()
  })

  it('assigns selected kids to a team', async () => {
    const f = fakeFetch(() => ({ json: [] }))
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    await user.click(within(screen.getByRole('region', { name: 'Denver' })).getByRole('button', { name: 'Move 2 here' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/athletes/assign')).toBe(true))
    const i = f.calls.findIndex(c => c.url === '/api/events/7/athletes/assign')
    expect(f.body(i)).toEqual({ ids: [300, 400], teamId: 2 })
  })

  it('saves an inline age edit as manual', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    const input = within(pool).getByLabelText('Age for Noah Kid')
    await user.type(input, '9')
    await user.tab()
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/athletes/300')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/athletes/300'))).toEqual({ age: 9 })
  })
})
