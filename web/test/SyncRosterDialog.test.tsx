import { useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SyncRosterDialog, SYNC_DEADLINE_MS, inFlightCopy, pullProgress } from '@/routes/event/SyncRosterDialog'
import { setAdminToken } from '@/lib/auth'
import { qk } from '@/lib/queries'
import type { EventDetail, SyncReport } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [], matches: [], candidateCount: 0,
}
const cand = { wlUid: '9', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Ridgeline', leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'F' }

function mount(d: EventDetail = detail, onReport: (r: SyncReport) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><SyncRosterDialog detail={d} open onOpenChange={() => {}} onReport={onReport} /></QueryClientProvider>)
  return qc
}

function Host() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sync</button>
      <SyncRosterDialog detail={detail} open={open} onOpenChange={setOpen} onReport={() => {}} />
    </>
  )
}

const footerButton = (name: string) =>
  within(document.querySelector('[data-slot="dialog-footer"]') as HTMLElement).getByRole('button', { name })

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
  const twoLocations = () => fakeFetch(url => {
    if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }, { kBusiness: '100002', title: 'South', city: 'Southtown' }] }
    if (url.endsWith('/roster/sync')) return { json: { candidates: [cand], warnings: [] } }
    return { json: {} }
  })

  it('names itself for the one press it is', async () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    expect(await screen.findByText('Sync from WellnessLiving')).toBeInTheDocument()
  })

  // Spec 7.2: the first sync picks the locations and the event stores them, so every
  // later sync opens on the pick the organizer already made rather than on all of them.
  it('prefills the locations the event stored', async () => {
    const f = twoLocations()
    mount({ ...detail, event: { ...detail.event, wlLocations: ['100002'] } })
    const user = userEvent.setup()
    expect(await screen.findByLabelText('South')).toBeChecked()
    expect(screen.getByLabelText('North')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/roster/sync'))).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url.endsWith('/roster/sync')))).toEqual({ kBusinesses: ['100002'] })
  })

  it('checks every location before the event has stored a pick', async () => {
    twoLocations()
    mount()
    expect(await screen.findByLabelText('North')).toBeChecked()
    expect(screen.getByLabelText('South')).toBeChecked()
  })

  // A location the gym has dropped is no longer offered, so a stored id for it cannot be
  // ticked and must not be posted.
  it('drops a stored location WellnessLiving no longer offers', async () => {
    const f = twoLocations()
    mount({ ...detail, event: { ...detail.event, wlLocations: ['100002', '999999'] } })
    const user = userEvent.setup()
    expect(await screen.findByLabelText('South')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/roster/sync'))).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url.endsWith('/roster/sync')))).toEqual({ kBusinesses: ['100002'] })
  })

  it('hands the report to the tab when it closes after a sync', async () => {
    fakeFetch(url => {
      if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }] }
      if (url.endsWith('/roster/sync')) {
        return { json: { candidates: [cand], warnings: [], report: { linked: ['Zoe Martin'], refreshed: 2, changed: [], suggested: [], ambiguous: [], unmatched: [], gone: [] } } }
      }
      return { json: {} }
    })
    const onReport = vi.fn()
    mount(detail, onReport)
    const user = userEvent.setup()
    await screen.findByLabelText('North')
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await screen.findByText('Linked 1. Refreshed 2, 0 changed.')
    expect(onReport).not.toHaveBeenCalled()
    await user.click(footerButton('Close'))
    expect(onReport).toHaveBeenCalledWith({ linked: ['Zoe Martin'], refreshed: 2, changed: [], suggested: [], ambiguous: [], unmatched: [], gone: [] })
  })

  it('hands nothing to the tab when it closes without a sync', async () => {
    twoLocations()
    const onReport = vi.fn()
    mount(detail, onReport)
    const user = userEvent.setup()
    await screen.findByLabelText('North')
    await user.click(footerButton('Close'))
    expect(onReport).not.toHaveBeenCalled()
  })

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
    await user.click(screen.getByRole('button', { name: 'Sync' }))
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
    await user.click(screen.getByRole('button', { name: 'Sync' }))
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
    await user.click(screen.getByRole('button', { name: 'Sync' }))

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

  /**
   * Spec 7.2. The sync links what it can on the way in, so the dialog owes the operator
   * the outcome in words: what it did, and by name every competitor a person still has to
   * deal with by hand.
   */
  describe('the sync report', () => {
    const pullWith = (report: unknown) => fakeFetch(url => {
      if (url.endsWith('/wl-locations')) return { json: [{ kBusiness: '100001', title: 'North', city: 'Northtown' }] }
      if (url.endsWith('/roster/sync')) return { json: { candidates: [cand], warnings: [], report } }
      return { json: {} }
    })

    const pull = async () => {
      const user = userEvent.setup()
      await screen.findByLabelText('North')
      await user.click(screen.getByRole('button', { name: 'Sync' }))
      await screen.findByText('Zoe Martin')
    }

    it('reads every list the report came back with', async () => {
      pullWith({
        linked: ['Zoe Martin', 'Kai Wong'], refreshed: 1, changed: ['Kai Wong'],
        suggested: [{ athleteId: 5, name: 'Mateo Rivera', candidate: 'Mateo Rivera-Lopez', location: 'Boulder', score: 0.82 }],
        ambiguous: ['Sam Lee'], unmatched: ['Ana Ruiz', 'Ben Oyelaran'], gone: ['Mia Park'],
      })
      mount()
      await pull()
      expect(screen.getByText('Linked 2. Refreshed 1, 1 changed.')).toBeInTheDocument()
      expect(screen.getByText('To confirm: Mateo Rivera looks like Mateo Rivera-Lopez, Boulder.')).toBeInTheDocument()
      expect(screen.getByText('Two candidates, link by hand: Sam Lee.')).toBeInTheDocument()
      expect(screen.getByText('Not found: Ana Ruiz, Ben Oyelaran.')).toBeInTheDocument()
      expect(screen.getByText('Gone from WellnessLiving: Mia Park.')).toBeInTheDocument()
    })

    it('prints one line when nothing is left to do by hand', async () => {
      pullWith({ linked: ['Zoe Martin'], refreshed: 0, changed: [], suggested: [], ambiguous: [], unmatched: [], gone: [] })
      mount()
      await pull()
      expect(screen.getByText('Linked 1. Refreshed 0, 0 changed.')).toBeInTheDocument()
      expect(screen.queryByText(/To confirm/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Not found/)).not.toBeInTheDocument()
      expect(screen.queryByText(/link by hand/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Gone from WellnessLiving/)).not.toBeInTheDocument()
    })

    // The pull writes to the roster, so the detail behind the dialog is stale the moment
    // it lands: the "on roster" badges and the Link buttons all read it.
    it('refetches the event after a pull', async () => {
      pullWith({ linked: [], refreshed: 0, changed: [], suggested: [], ambiguous: [], unmatched: [], gone: [] })
      const qc = mount()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      await pull()
      await vi.waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: qk.event(7) }))
    })
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
    await user.click(screen.getByRole('button', { name: 'Sync' }))

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
