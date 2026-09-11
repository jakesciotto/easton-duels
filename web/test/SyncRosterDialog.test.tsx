import { StrictMode, useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SyncRosterDialog, SYNC_DEADLINE_MS, pullProgress } from '@/routes/event/SyncRosterDialog'
import { setAdminToken } from '@/lib/auth'
import { qk } from '@/lib/queries'
import type { EventDetail, RosterCandidate, SyncReport } from '@/lib/types'
import { fakeFetch, type Reply } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [], matches: [], candidateCount: 0,
}
const cand: RosterCandidate = { wlUid: '9', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Ridgeline', leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'F' }
const kai: RosterCandidate = { ...cand, wlUid: '10', firstName: 'Kai', lastName: 'Wong', erp: null }
const CLEAN: SyncReport = { linked: [], refreshed: 0, changed: [], suggested: [], ambiguous: [], unmatched: [], gone: [] }

function mount(d: EventDetail = detail, onReport: (r: SyncReport) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><SyncRosterDialog detail={d} open onOpenChange={() => {}} onReport={onReport} /></QueryClientProvider>)
  return qc
}

function Host({ onReport = () => {} }: { onReport?: (r: SyncReport) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sync</button>
      <SyncRosterDialog detail={detail} open={open} onOpenChange={setOpen} onReport={onReport} />
    </>
  )
}

const footerButton = (name: string) =>
  within(document.querySelector('[data-slot="dialog-footer"]') as HTMLElement).getByRole('button', { name })

function mountHost(onReport: (r: SyncReport) => void = () => {}, strict = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = <QueryClientProvider client={qc}><Host onReport={onReport} /></QueryClientProvider>
  const { unmount } = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { qc, unmount }
}

/** The sync answers, the search answers, everything else is an empty write. */
function wl({ report = CLEAN, warnings = [] as string[], results = [] as RosterCandidate[], search }: {
  report?: SyncReport
  warnings?: string[]
  results?: RosterCandidate[]
  search?: (url: string) => Reply
} = {}) {
  return fakeFetch((url, init) => {
    if (url.endsWith('/roster/sync')) return { json: { candidates: results, warnings, report } }
    if (url.includes('/wl-search')) return search === undefined ? { json: results } : search(url)
    if (url.endsWith('/athletes') && init?.method === 'POST') return { status: 201, json: [] }
    return { json: {} }
  })
}

const syncCalls = (calls: { url: string }[]) => calls.filter(c => c.url.endsWith('/roster/sync'))

describe('sync progress', () => {
  it('reports the share of the 280 second budget spent, bounded at both ends', () => {
    expect(SYNC_DEADLINE_MS).toBe(280_000)
    expect(pullProgress(0)).toBe(0)
    expect(pullProgress(SYNC_DEADLINE_MS / 2)).toBe(50)
    expect(pullProgress(SYNC_DEADLINE_MS * 3)).toBe(100)
  })
})

describe('SyncRosterDialog', () => {
  it('names itself for the one press it is', async () => {
    wl()
    mount()
    expect(await screen.findByText('Sync from WellnessLiving')).toBeInTheDocument()
  })

  // Spec 4. The sync asks WellnessLiving for the roster's own names, so there is nothing
  // to pick and nothing to press: opening the dialog is the press.
  it('syncs as soon as it opens, with no body and no locations to pick', async () => {
    const f = wl()
    mount()
    await vi.waitFor(() => expect(syncCalls(f.calls)).toHaveLength(1))
    expect(syncCalls(f.calls)[0].url).toBe('/api/events/7/roster/sync')
    expect(f.calls.find(c => c.url.endsWith('/roster/sync'))?.init?.body).toBeUndefined()
    expect(f.calls.some(c => c.url.includes('/wl-locations'))).toBe(false)
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
  })

  it('prints every line the report came back with', async () => {
    wl({
      report: {
        linked: ['Zoe Martin', 'Kai Wong'], refreshed: 1, changed: ['Kai Wong'],
        suggested: [{ athleteId: 5, name: 'Mateo Rivera', candidate: 'Mateo Rivera-Lopez', location: 'Boulder', score: 0.82 }],
        ambiguous: ['Sam Lee'], unmatched: ['Ana Ruiz', 'Ben Oyelaran'], gone: ['Mia Park'],
      },
    })
    mount()
    expect(await screen.findByText('Linked 2. Refreshed 1, 1 changed.')).toBeInTheDocument()
    expect(screen.getByText('To confirm: Mateo Rivera looks like Mateo Rivera-Lopez, Boulder.')).toBeInTheDocument()
    expect(screen.getByText('Two candidates, link by hand: Sam Lee.')).toBeInTheDocument()
    expect(screen.getByText('Not found: Ana Ruiz, Ben Oyelaran.')).toBeInTheDocument()
    expect(screen.getByText('Gone from WellnessLiving: Mia Park.')).toBeInTheDocument()
  })

  it('prints one line when nothing is left to do by hand', async () => {
    wl({ report: { ...CLEAN, linked: ['Zoe Martin'] } })
    mount()
    expect(await screen.findByText('Linked 1. Refreshed 0, 0 changed.')).toBeInTheDocument()
    expect(screen.queryByText(/To confirm/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Not found/)).not.toBeInTheDocument()
    expect(screen.queryByText(/link by hand/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Gone from WellnessLiving/)).not.toBeInTheDocument()
  })

  it('reads the warnings the sync came back with', async () => {
    wl({ warnings: ['Leaderboard not configured. No ERP join.'] })
    mount()
    expect(await screen.findByText(/No ERP join/)).toBeInTheDocument()
  })

  it('runs the sync again on Sync again', async () => {
    const f = wl()
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sync again' }))
    await vi.waitFor(() => expect(syncCalls(f.calls)).toHaveLength(2))
  })

  it('hands the report to the tab when it closes after a sync', async () => {
    const report: SyncReport = { ...CLEAN, linked: ['Zoe Martin'], refreshed: 2 }
    wl({ report })
    const onReport = vi.fn()
    mount(detail, onReport)
    const user = userEvent.setup()
    await screen.findByText('Linked 1. Refreshed 2, 0 changed.')
    expect(onReport).not.toHaveBeenCalled()
    await user.click(footerButton('Close'))
    expect(onReport).toHaveBeenCalledWith(report)
  })

  it('hands nothing to the tab when the sync never answered', async () => {
    fakeFetch(url => (url.endsWith('/roster/sync') ? new Promise<Reply>(() => {}) : { json: {} }))
    const onReport = vi.fn()
    mount(detail, onReport)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await user.click(footerButton('Close'))
    expect(onReport).not.toHaveBeenCalled()
  })

  it('shows the not-configured message from a 503', async () => {
    fakeFetch(() => ({ status: 503, json: { error: { code: 'wl_not_configured', message: 'WellnessLiving credentials are not set' } } }))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('credentials are not set')
  })

  // The sync links what it can on the way in, so the roster behind this dialog is stale
  // the moment it lands: the "on roster" badge reads it.
  it('refetches the event after a sync', async () => {
    wl()
    const qc = mount()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: qk.event(7) }))
  })

  it('shows a determinate bar and a Stop from the first second, and Stop abandons the sync', async () => {
    let resolveSync: (v: Reply) => void = () => {}
    const held = new Promise<Reply>(resolve => { resolveSync = resolve })
    fakeFetch(url => (url.endsWith('/roster/sync') ? held : { json: {} }))
    mount()
    const user = userEvent.setup()

    // 6.12: the server's budget is 280 seconds, so a percent-done readout and a
    // signposted interrupt are mandatory and neither may wait for the first response.
    const bar = screen.getByRole('progressbar', { name: 'Roster sync' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(/Searching WellnessLiving/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped waiting')

    // A sync that lands after Stop must never report behind the operator.
    await act(async () => {
      resolveSync({ json: { candidates: [], warnings: [], report: { ...CLEAN, linked: ['Zoe Martin'] } } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(screen.queryByText('Linked 1. Refreshed 0, 0 changed.')).not.toBeInTheDocument()
  })

  it('syncs again and drops the last report when reopened', async () => {
    const f = wl({ report: { ...CLEAN, linked: ['Zoe Martin'] } })
    mountHost()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await screen.findByText('Linked 1. Refreshed 0, 0 changed.')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await vi.waitFor(() => expect(syncCalls(f.calls)).toHaveLength(2))
  })

  it('ignores a sync that resolves after a close mid-sync and a reopen', async () => {
    let resolveSync: (v: Reply) => void = () => {}
    const held = new Promise<Reply>(resolve => { resolveSync = resolve })
    let first = true
    fakeFetch(url => {
      if (!url.endsWith('/roster/sync')) return { json: {} }
      if (first) { first = false; return held }
      return { json: { candidates: [], warnings: [], report: { ...CLEAN, refreshed: 4 } } }
    })
    mountHost()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await screen.findByText('Linked 0. Refreshed 4, 0 changed.')

    await act(async () => {
      resolveSync({ json: { candidates: [], warnings: [], report: { ...CLEAN, refreshed: 99 } } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(screen.queryByText('Linked 0. Refreshed 99, 0 changed.')).not.toBeInTheDocument()
  })

  // The close is the only bump a sync that is never reopened will ever get, so the effect
  // owes one on the way out: without it the answer lands on a dialog nobody is looking at,
  // refetches the event behind the screen, and waits there for the next open.
  it('drops a sync that lands after a close that is never reopened', async () => {
    let resolveSync: (v: Reply) => void = () => {}
    const held = new Promise<Reply>(resolve => { resolveSync = resolve })
    fakeFetch(url => (url.endsWith('/roster/sync') ? held : { json: {} }))
    const onReport = vi.fn()
    const logged = vi.spyOn(console, 'error')
    const { qc } = mountHost(onReport)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    expect(screen.getByRole('progressbar', { name: 'Roster sync' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const invalidated = vi.spyOn(qc, 'invalidateQueries')

    await act(async () => {
      resolveSync({ json: { candidates: [], warnings: [], report: { ...CLEAN, linked: ['Zoe Martin'] } } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(onReport).not.toHaveBeenCalled()
    expect(invalidated).not.toHaveBeenCalled()
    expect(screen.queryByText('Linked 1. Refreshed 0, 0 changed.')).not.toBeInTheDocument()
    expect(logged).not.toHaveBeenCalled()
  })

  it('drops a sync that lands after the dialog is gone', async () => {
    let resolveSync: (v: Reply) => void = () => {}
    const held = new Promise<Reply>(resolve => { resolveSync = resolve })
    fakeFetch(url => (url.endsWith('/roster/sync') ? held : { json: {} }))
    const logged = vi.spyOn(console, 'error')
    const { qc, unmount } = mountHost()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    expect(screen.getByRole('progressbar', { name: 'Roster sync' })).toBeInTheDocument()

    const invalidated = vi.spyOn(qc, 'invalidateQueries')
    unmount()

    await act(async () => {
      resolveSync({ json: { candidates: [], warnings: [], report: { ...CLEAN, linked: ['Zoe Martin'] } } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(invalidated).not.toHaveBeenCalled()
    expect(logged).not.toHaveBeenCalled()
  })

  // Strict Mode double invokes an effect on MOUNT, and both mount sites render this dialog
  // closed, so the press that opens it is a single run and the cleanup does not cost a
  // second pull.
  it('starts exactly one sync per open under Strict Mode', async () => {
    const f = wl()
    const logged = vi.spyOn(console, 'error')
    mountHost(() => {}, true)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open sync' }))
    await screen.findByText('Linked 0. Refreshed 0, 0 changed.')
    expect(syncCalls(f.calls)).toHaveLength(1)
    expect(logged).not.toHaveBeenCalled()
  })

  /**
   * Spec 4. The pool the sync stores is the subset it found, so anybody else is reached
   * by name through the search route rather than by scrolling the gym.
   */
  describe('adding from WellnessLiving', () => {
    it('asks for two letters before it searches', async () => {
      const f = wl({ results: [cand] })
      mount()
      const user = userEvent.setup()
      const field = await screen.findByLabelText('Add from WellnessLiving')
      expect(screen.getByText('Type at least two letters.')).toBeInTheDocument()
      await user.type(field, 'm')
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(f.calls.some(c => c.url.includes('/wl-search'))).toBe(false)
      expect(screen.getByText('Type at least two letters.')).toBeInTheDocument()
    })

    it('searches by name and adds the ticked rows', async () => {
      const f = wl({ results: [cand, kai] })
      mount()
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText('Add from WellnessLiving'), 'martin')
      expect(await screen.findByText('Zoe Martin')).toBeInTheDocument()
      expect(f.calls.filter(c => c.url.includes('/wl-search')).at(-1)?.url).toBe('/api/events/7/wl-search?q=martin')
      // 7.14: the rating is a value in its own aligned track, so the ordering is visible.
      expect(screen.getByText('5.2')).toBeInTheDocument()

      await user.click(screen.getByLabelText('Select Zoe Martin'))
      await user.click(footerButton('Add 1 competitor'))
      await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
      expect(f.body(f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST'))).toEqual({ candidates: [cand] })
    })

    // A pick is a decision about a person, not about the query that found them.
    it('keeps a pick made under an earlier query', async () => {
      const f = wl({ search: url => (url.endsWith('q=martin') ? { json: [cand] } : { json: [kai] }) })
      mount()
      const user = userEvent.setup()
      const field = await screen.findByLabelText('Add from WellnessLiving')
      await user.type(field, 'martin')
      await user.click(await screen.findByLabelText('Select Zoe Martin'))
      await user.clear(field)
      await user.type(field, 'wong')
      await user.click(await screen.findByLabelText('Select Kai Wong'))
      await user.click(footerButton('Add 2 competitors'))
      await vi.waitFor(() => expect(f.calls.some(c => c.url.endsWith('/athletes') && c.init?.method === 'POST')).toBe(true))
      expect(f.body(f.calls.findIndex(c => c.url.endsWith('/athletes') && c.init?.method === 'POST'))).toEqual({ candidates: [cand, kai] })
    })

    it('says so when the search finds nobody', async () => {
      wl({ results: [] })
      mount()
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText('Add from WellnessLiving'), 'martin')
      expect(await screen.findByText('No competitors match that name.')).toBeInTheDocument()
    })

    it('reports a 503 from the search the way the sync reports one', async () => {
      wl({ search: () => ({ status: 503, json: { error: { code: 'wl_not_configured', message: 'WellnessLiving credentials are not set' } } }) })
      mount()
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText('Add from WellnessLiving'), 'martin')
      const alert = await screen.findByRole('alert')
      expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('WellnessLiving did not answer')
      expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('credentials are not set')
    })

    it('marks a candidate already on the roster', async () => {
      wl({ results: [cand] })
      mount({
        ...detail,
        athletes: [{
          id: 1, eventId: 7, teamId: null, firstName: 'Zoe', lastName: 'Martin', age: 8, ageSource: 'wl', weightLbs: 60, weightSource: 'manual',
          belt: 'grey', gender: 'F', source: 'wl', wlUid: '9', wlLocation: 'Ridgeline', leaderboardId: null, erp: null,
          promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
        }],
      })
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText('Add from WellnessLiving'), 'martin')
      expect(await screen.findByText('on roster')).toBeInTheDocument()
    })

    it('offers no search until the sync has answered', async () => {
      fakeFetch(url => (url.endsWith('/roster/sync') ? new Promise<Reply>(() => {}) : { json: {} }))
      mount()
      expect(screen.queryByLabelText('Add from WellnessLiving')).not.toBeInTheDocument()
    })
  })
})
