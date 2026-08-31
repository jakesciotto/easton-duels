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
    expect(within(pool).getByText((_, el) => el?.textContent === 'ERP 5.2')).toBeInTheDocument()
  })

  it('lays out the team grid at two columns on medium screens and three on extra-large', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const grid = screen.getByRole('region', { name: 'Boulder' }).parentElement
    expect(grid?.className).toContain('lg:grid-cols-2')
    expect(grid?.className).toContain('xl:grid-cols-3')
    expect(grid?.className).not.toContain('lg:grid-cols-3')
  })

  it('splits each roster row into a name line and a separate wrapping meta line', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    const nameCell = within(pool).getByText('Noah Kid')
    const nameLine = nameCell.parentElement as HTMLElement
    expect(within(nameLine).getByRole('button', { name: 'Remove Noah Kid' })).toBeInTheDocument()
    expect(within(nameLine).queryByText('Grey')).not.toBeInTheDocument()
    const row = nameLine.parentElement as HTMLElement
    expect(within(row).getByText('Grey')).toBeInTheDocument()
    expect(within(row).getByText('missing age')).toBeInTheDocument()
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

  it('shows the server error when an assign fails, without an unhandled rejection', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/events/7/athletes/assign' && init?.method === 'POST') {
        return { status: 422, json: { error: { code: 'validation', message: 'teamId is not on this event' } } }
      }
      return { json: [] }
    })
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(within(screen.getByRole('region', { name: 'Denver' })).getByRole('button', { name: 'Move 1 here' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('teamId is not on this event')
  })

  it('removes a kid through a confirm dialog', async () => {
    const f = fakeFetch((url, init) => (url === '/api/athletes/300' && init?.method === 'DELETE' ? { status: 204 } : { json: [] }))
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('button', { name: 'Remove Noah Kid' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove Noah Kid?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/athletes/300' && c.init?.method === 'DELETE')).toBe(true))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the remove dialog open and shows the message when the kid is in a match', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/athletes/300' && init?.method === 'DELETE') {
        return { status: 409, json: { error: { code: 'match_state', message: 'athlete is in a match; delete the match first' } } }
      }
      return { json: [] }
    })
    mount()
    const user = userEvent.setup()
    await user.click(within(screen.getByRole('region', { name: 'Unassigned' })).getByRole('button', { name: 'Remove Noah Kid' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('athlete is in a match; delete the match first')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
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

  it('shows the server validation error when adding a kid fails, without an unhandled rejection', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/events/7/athletes' && init?.method === 'POST') {
        return { status: 422, json: { error: { code: 'validation', message: 'age must be between 3 and 17' } } }
      }
      return { json: [] }
    })
    mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add competitor' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('First name'), 'Kai')
    await user.type(within(dialog).getByLabelText('Last name'), 'Wong')
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('age must be between 3 and 17')
  })
})
