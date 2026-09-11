import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddKidDialog } from '@/routes/event/AddKidDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, RosterCandidate } from '@/lib/types'
import { fakeFetch, type Reply } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const athlete = (id: number, wlUid: string | null, first: string, last: string): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId: null, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: wlUid ? 'wl' : 'manual', wlUid, wlLocation: wlUid ? 'Ridgeline' : null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
})
const cand = (over: Partial<RosterCandidate>): RosterCandidate => ({
  wlUid: 'u0', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Ridgeline', leaderboardId: null, erp: null, age: 8, weightLbs: 60, gender: 'F', ...over,
})
const zoe = cand({ wlUid: 'u1', firstName: 'Zoe', lastName: 'Martin', erp: 5.2 })
const kai = cand({ wlUid: 'u3', firstName: 'Kai', lastName: 'Wong' })
const mia = cand({ wlUid: 'u5', firstName: 'Mia', lastName: 'Diaz', erp: 7.0 })

const baseDetail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [athlete(100, 'u5', 'Mia', 'Diaz')],
  rulesets: [], mats: [], matches: [],
  candidateCount: 4,
}

/** The search answers, everything else is an empty write. */
function wl(search: (url: string) => Reply) {
  return fakeFetch((url, init) => {
    if (url.includes('/wl-search')) return search(url)
    if (url.endsWith('/athletes') && init?.method === 'POST') return { status: 201, json: [] }
    return { json: {} }
  })
}

function mount(detail: EventDetail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AddKidDialog detail={detail} open onOpenChange={() => {}} /></QueryClientProvider>)
}

const searchField = () => screen.getByLabelText('Search')

describe('AddKidDialog', () => {
  // Spec 4. The cached pool is the subset the last sync found, so there is nothing to
  // browse: anybody else is reached by name.
  it('defaults to the WellnessLiving tab once a sync has found a pool, and searches by name', async () => {
    const f = wl(() => ({ json: [zoe, kai] }))
    mount(baseDetail)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'From WellnessLiving' })).toHaveAttribute('aria-selected', 'true')
    expect(f.calls.some(c => c.url.includes('/candidates'))).toBe(false)

    await userEvent.setup().type(searchField(), 'martin')
    expect(await screen.findByText('Zoe Martin')).toBeInTheDocument()
    expect(f.calls.filter(c => c.url.includes('/wl-search')).at(-1)?.url).toBe('/api/events/7/wl-search?q=martin')
  })

  it('asks for two letters before it searches', async () => {
    const f = wl(() => ({ json: [zoe] }))
    mount(baseDetail)
    await screen.findByRole('dialog')
    expect(screen.getByText('Type at least two letters.')).toBeInTheDocument()
    await userEvent.setup().type(searchField(), 'm')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(f.calls.some(c => c.url.includes('/wl-search'))).toBe(false)
  })

  it('leaves out whoever is already on the roster', async () => {
    wl(() => ({ json: [zoe, mia] }))
    mount(baseDetail)
    await userEvent.setup().type(await screen.findByLabelText('Search'), 'ridgeline')
    expect(await screen.findByText('Zoe Martin')).toBeInTheDocument()
    // Mia Diaz is already on the roster under u5.
    expect(screen.queryByText('Mia Diaz')).not.toBeInTheDocument()
  })

  it('posts the picked candidates plus teamId when a team is chosen', async () => {
    const f = wl(() => ({ json: [zoe] }))
    mount(baseDetail)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Search'), 'martin')
    await user.click(await screen.findByLabelText('Select Zoe Martin'))
    await user.click(screen.getByRole('combobox', { name: 'Team' }))
    await user.click(await screen.findByRole('option', { name: 'Lakeside' }))
    await user.click(screen.getByRole('button', { name: 'Add 1 competitor' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
    const i = f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')
    expect(f.body(i)).toEqual({ candidates: [zoe], teamId: 2 })
  })

  it('omits teamId from the post when the team stays unassigned', async () => {
    const f = wl(() => ({ json: [zoe] }))
    mount(baseDetail)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Search'), 'martin')
    await user.click(await screen.findByLabelText('Select Zoe Martin'))
    await user.click(screen.getByRole('button', { name: 'Add 1 competitor' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
    const i = f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')
    expect(f.body(i)).toEqual({ candidates: [zoe] })
  })

  // A pick is a decision about a person, not about the query that found them.
  it('keeps a pick made under an earlier query', async () => {
    const f = wl(url => (url.endsWith('q=martin') ? { json: [zoe] } : { json: [kai] }))
    mount(baseDetail)
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Search')
    await user.type(field, 'martin')
    await user.click(await screen.findByLabelText('Select Zoe Martin'))
    await user.clear(field)
    await user.type(field, 'wong')
    await user.click(await screen.findByLabelText('Select Kai Wong'))
    await user.click(screen.getByRole('button', { name: 'Add 2 competitors' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
    const i = f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')
    expect(f.body(i)).toEqual({ candidates: [zoe, kai] })
  })

  it('says so when the search finds nobody', async () => {
    wl(() => ({ json: [] }))
    mount(baseDetail)
    await userEvent.setup().type(await screen.findByLabelText('Search'), 'martin')
    expect(await screen.findByText('No competitors match that name.')).toBeInTheDocument()
  })

  it('reports a 503 from the search', async () => {
    wl(() => ({ status: 503, json: { error: { code: 'wl_not_configured', message: 'WellnessLiving credentials are not set' } } }))
    mount(baseDetail)
    await userEvent.setup().type(await screen.findByLabelText('Search'), 'martin')
    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('WellnessLiving did not answer')
    expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('credentials are not set')
  })

  // 6.10: virtualized past 50 rows, because a two token query can match a whole belt.
  it('virtualizes the results once they pass fifty rows', async () => {
    const many = Array.from({ length: 60 }, (_, i) => cand({ wlUid: `w${i}`, firstName: `First${i}`, lastName: `Last${i}`, erp: 5 }))
    wl(() => ({ json: many }))
    mount({ ...baseDetail, athletes: [] })
    await userEvent.setup().type(await screen.findByLabelText('Search'), 'last')
    await screen.findByText('First0 Last0')
    const rows = screen.getAllByRole('checkbox').filter(cb => cb.getAttribute('aria-label')?.startsWith('Select'))
    expect(rows.length).toBeLessThan(60)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('defaults to manual before any sync has found a pool, and still searches from the other tab', async () => {
    wl(() => ({ json: [zoe] }))
    mount({ ...baseDetail, candidateCount: 0 })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true')
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('tab', { name: 'From WellnessLiving' }))
    await user.type(await within(dialog).findByLabelText('Search'), 'martin')
    expect(await screen.findByText('Zoe Martin')).toBeInTheDocument()
  })

  it('still adds a manual competitor and shows a validation error', async () => {
    fakeFetch((url, init) => {
      if (url.endsWith('/athletes') && init?.method === 'POST') {
        return { status: 422, json: { error: { code: 'validation', message: 'age must be between 3 and 17' } } }
      }
      return { json: {} }
    })
    mount({ ...baseDetail, candidateCount: 0 })
    const dialog = await screen.findByRole('dialog')
    const user = userEvent.setup()
    await user.type(within(dialog).getByLabelText('First name'), 'Kai')
    await user.type(within(dialog).getByLabelText('Last name'), 'Wong')
    await user.click(within(dialog).getByRole('button', { name: 'Add competitor' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('age must be between 3 and 17')
  })
})
