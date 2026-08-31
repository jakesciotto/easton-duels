import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddKidDialog } from '@/routes/event/AddKidDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, RosterCandidate } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const athlete = (id: number, wlUid: string | null, first: string, last: string): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId: null, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: wlUid ? 'wl' : 'manual', wlUid, wlLocation: wlUid ? 'Boulder' : null, leaderboardId: null, erp: null,
})
const cand = (over: Partial<RosterCandidate>): RosterCandidate => ({
  wlUid: 'u0', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Boulder', leaderboardId: null, erp: null, age: 8, weightLbs: 60, gender: 'F', ...over,
})
const pool: RosterCandidate[] = [
  cand({ wlUid: 'u1', firstName: 'Zoe', lastName: 'Martin', erp: 5.2 }),
  cand({ wlUid: 'u2', firstName: 'Ana', lastName: 'Bell', erp: 6.1 }),
  cand({ wlUid: 'u3', firstName: 'Kai', lastName: 'Wong', erp: null }),
  cand({ wlUid: 'u4', firstName: 'Eli', lastName: 'Cruz', erp: null }),
  cand({ wlUid: 'u5', firstName: 'Mia', lastName: 'Diaz', erp: 7.0 }),
]

const baseDetail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [athlete(100, 'u5', 'Mia', 'Diaz')],
  rulesets: [], mats: [], matches: [],
  candidateCount: pool.length,
}

function mount(detail: EventDetail, onRefresh = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AddKidDialog detail={detail} open onOpenChange={() => {}} onRefresh={onRefresh} /></QueryClientProvider>)
  return { onRefresh }
}

describe('AddKidDialog', () => {
  it('defaults to the pool tab, excludes roster members, and shows only rated candidates sorted by erp descending', async () => {
    fakeFetch(url => (url.endsWith('/candidates') ? { json: pool } : { json: {} }))
    mount(baseDetail)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'From pool' })).toHaveAttribute('aria-selected', 'true')
    // Mia Diaz is already on the roster (wlUid u5) and must not appear, rated or not.
    await screen.findByText('Zoe Martin')
    expect(screen.queryByText('Mia Diaz')).not.toBeInTheDocument()
    expect(screen.queryByText('Kai Wong')).not.toBeInTheDocument()
    const rows = within(dialog).getAllByRole('checkbox').filter(cb => cb.getAttribute('aria-label')?.startsWith('Select'))
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['Select Ana Bell', 'Select Zoe Martin'])
  })

  it('reveals unrated candidates sorted by last name when the toggle is checked', async () => {
    fakeFetch(url => (url.endsWith('/candidates') ? { json: pool } : { json: {} }))
    mount(baseDetail)
    await screen.findByText('Zoe Martin')
    expect(screen.queryByText('Eli Cruz')).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Show unrated competitors'))
    const names = screen.getAllByRole('checkbox')
      .filter(cb => cb.getAttribute('aria-label')?.startsWith('Select'))
      .map(cb => cb.getAttribute('aria-label'))
    expect(names).toEqual(['Select Ana Bell', 'Select Zoe Martin', 'Select Eli Cruz', 'Select Kai Wong'])
  })

  it('posts the picked candidates plus teamId when a team is chosen', async () => {
    const f = fakeFetch((url, init) => {
      if (url.endsWith('/candidates')) return { json: pool }
      if (url.endsWith('/athletes') && init?.method === 'POST') return { status: 201, json: [] }
      return { json: {} }
    })
    mount(baseDetail)
    const user = userEvent.setup()
    await screen.findByText('Zoe Martin')
    await user.click(screen.getByLabelText('Select Zoe Martin'))
    await user.click(screen.getByRole('combobox', { name: 'Team' }))
    await user.click(await screen.findByRole('option', { name: 'Denver' }))
    await user.click(screen.getByRole('button', { name: 'Add 1 competitor' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
    const i = f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')
    expect(f.body(i)).toEqual({ candidates: [pool[0]], teamId: 2 })
  })

  it('omits teamId from the post when the team stays unassigned', async () => {
    const f = fakeFetch((url, init) => {
      if (url.endsWith('/candidates')) return { json: pool }
      if (url.endsWith('/athletes') && init?.method === 'POST') return { status: 201, json: [] }
      return { json: {} }
    })
    mount(baseDetail)
    const user = userEvent.setup()
    await screen.findByText('Zoe Martin')
    await user.click(screen.getByLabelText('Select Zoe Martin'))
    await user.click(screen.getByRole('button', { name: 'Add 1 competitor' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
    const i = f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')
    expect(f.body(i)).toEqual({ candidates: [pool[0]] })
  })

  it('defaults to manual when no pool exists yet, and the pool tab points at the import', async () => {
    fakeFetch(url => (url.endsWith('/candidates') ? { json: [] } : { json: {} }))
    const { onRefresh } = mount({ ...baseDetail, candidateCount: 0 })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true')
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('tab', { name: 'From pool' }))
    expect(await within(dialog).findByText(/No pool yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Sync from WellnessLiving' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('still adds a manual competitor and shows a validation error', async () => {
    fakeFetch((url, init) => {
      if (url.endsWith('/candidates')) return { json: [] }
      if (url.endsWith('/athletes') && init?.method === 'POST') {
        return { status: 422, json: { error: { code: 'validation', message: 'age must be between 3 and 17' } } }
      }
      return { json: {} }
    })
    const detail = { ...baseDetail, candidateCount: 0 }
    mount(detail)
    const dialog = await screen.findByRole('dialog')
    const user = userEvent.setup()
    await user.type(within(dialog).getByLabelText('First name'), 'Kai')
    await user.type(within(dialog).getByLabelText('Last name'), 'Wong')
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('age must be between 3 and 17')
  })
})
