import { useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SyncRosterDialog, SYNC_DEADLINE_MS, inFlightCopy, pullProgress } from '@/routes/event/SyncRosterDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [], matches: [], candidateCount: 0,
}
const cand = { wlUid: '9', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Ridgeline', leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'F' }

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><SyncRosterDialog detail={detail} open onOpenChange={() => {}} /></QueryClientProvider>)
}

function Host() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sync</button>
      <SyncRosterDialog detail={detail} open={open} onOpenChange={setOpen} />
    </>
  )
}

function mountHost() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><Host /></QueryClientProvider>)
}

describe('sync progress', () => {
  it('reports the share of the 280 second budget spent, bounded at both ends', () => {
    expect(SYNC_DEADLINE_MS).toBe(280_000)
    expect(pullProgress(0)).toBe(0)
    expect(pullProgress(SYNC_DEADLINE_MS / 2)).toBe(50)
    expect(pullProgress(SYNC_DEADLINE_MS * 3)).toBe(100)
  })

  it('names what is in flight without listing every location', () => {
    expect(inFlightCopy(['North'])).toBe('North')
    expect(inFlightCopy(['North', 'South'])).toBe('North and South')
    expect(inFlightCopy(['North', 'South', 'East', 'West'])).toBe('North, South and 2 more')
  })
})

describe('SyncRosterDialog', () => {
  it('shows the not-configured message from a 503', async () => {
    fakeFetch(() => ({ status: 503, json: { error: { code: 'wl_not_configured', message: 'WellnessLiving credentials are not set' } } }))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('credentials are not set')
  })

  it('lists locations, pulls candidates, filters, and adds the ticked ones', async () => {
    const f = fakeFetch((url, init) => {
      if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }, { kBusiness: '100002', title: 'South', city: 'Southtown' }] }
      if (url.endsWith('/roster/sync')) return { json: { candidates: [cand, { ...cand, wlUid: '10', firstName: 'Kai', lastName: 'Wong', erp: null }], warnings: ['Leaderboard not configured. No ERP join.'] } }
      if (url.endsWith('/athletes') && init?.method === 'POST') return { status: 201, json: [] }
      return { json: {} }
    })
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByLabelText('South'))
    await user.click(screen.getByRole('button', { name: 'Pull roster' }))
    expect(await screen.findByText('Zoe Martin')).toBeInTheDocument()
    expect(screen.getByText(/No ERP join/)).toBeInTheDocument()
    expect(f.body(f.calls.findIndex(c => c.url.endsWith('/roster/sync')))).toEqual({ kBusinesses: ['100001'] })
    await user.type(screen.getByLabelText('Search'), 'zoe')
    expect(screen.queryByText('Kai Wong')).not.toBeInTheDocument()
    // 7.14: the rating stops being a Badge and becomes a value in its own right
    // aligned track, so the ordering is visibly the ordering.
    expect(screen.getByText('5.2')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Select Zoe Martin'))
    await user.click(screen.getByRole('button', { name: 'Add 1 competitor' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST'))).toEqual({ candidates: [cand] })
  })

  it('resets pulled candidates, ticks, and search when reopened', async () => {
    fakeFetch(url => {
      if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }] }
      if (url.endsWith('/roster/sync')) return { json: { candidates: [cand], warnings: [] } }
      return { json: {} }
    })
    mountHost()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await screen.findByLabelText('North')
    await user.click(screen.getByRole('button', { name: 'Pull roster' }))
    expect(await screen.findByText('Zoe Martin')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search'), 'zoe')
    await user.click(screen.getByLabelText('Select Zoe Martin'))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    expect(await screen.findByLabelText('North')).toBeInTheDocument()
    expect(screen.queryByText('Zoe Martin')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument()
  })

  it('ignores a pull that resolves after a close mid-pull and a reopen', async () => {
    let resolveSync: (v: { candidates: typeof cand[]; warnings: string[] }) => void = () => {}
    const syncPromise = new Promise<{ candidates: typeof cand[]; warnings: string[] }>(resolve => { resolveSync = resolve })
    fakeFetch(url => {
      if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }] }
      if (url.endsWith('/roster/sync')) return syncPromise.then(v => ({ json: v }))
      return { json: {} }
    })
    mountHost()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await screen.findByLabelText('North')
    await user.click(screen.getByRole('button', { name: 'Pull roster' }))

    // Close mid-pull, then reopen before the stale response lands -- the reopen resets state for
    // a new session, and the first pull's response has to be discarded rather than repopulate it.
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await screen.findByLabelText('North')

    await act(async () => {
      resolveSync({ candidates: [cand], warnings: [] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(screen.queryByText('Zoe Martin')).not.toBeInTheDocument()
  })

  it('shows a determinate bar and a Stop from the first second, and Stop abandons the pull', async () => {
    let resolveSync: (v: { candidates: typeof cand[]; warnings: string[] }) => void = () => {}
    const syncPromise = new Promise<{ candidates: typeof cand[]; warnings: string[] }>(resolve => { resolveSync = resolve })
    fakeFetch(url => {
      if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }] }
      if (url.endsWith('/roster/sync')) return syncPromise.then(v => ({ json: v }))
      return { json: {} }
    })
    mount()
    const user = userEvent.setup()
    await screen.findByLabelText('North')
    await user.click(screen.getByRole('button', { name: 'Pull roster' }))

    // 6.12: 280 seconds is 28 times the attention limit, so a percent-done readout and
    // a signposted interrupt are mandatory and neither may wait for the first response.
    const bar = screen.getByRole('progressbar', { name: 'Roster sync' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(/Pulling North/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped waiting')

    // A pull that lands after Stop must never repopulate the list behind the operator.
    await act(async () => {
      resolveSync({ candidates: [cand], warnings: [] })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(screen.queryByText('Zoe Martin')).not.toBeInTheDocument()
  })
})
