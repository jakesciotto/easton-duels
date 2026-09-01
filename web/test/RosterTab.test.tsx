import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminShell } from '@/components/AdminShell'
import { RosterTab } from '@/routes/event/RosterTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).elementFromPoint
})

const kid = (id: number, teamId: number | null, first: string, over: Partial<EventDetail['athletes'][number]> = {}): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: 'Kid', age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null, ...over,
})
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', mode: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo'), kid(200, 2, 'Olivia'), kid(300, null, 'Noah', { age: null, ageSource: null }), kid(400, null, 'Zoe', { weightSource: 'leaderboard', erp: 5.2 })],
  rulesets: [], mats: [], matches: [], candidateCount: 0,
}

// Noah (300) is sitting in a pending match, which is the exact condition the server
// refuses a delete on.
const placed: EventDetail = {
  ...detail,
  matches: [{
    id: 1, eventId: 7, matId: null, orderIndex: 0, rulesetId: 1, lengthSec: 300,
    athleteAId: 300, athleteBId: 200, status: 'pending', winnerAthleteId: null, winType: null,
    pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
    pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
  }],
}

function mount(d: EventDetail = detail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RosterTab detail={d} /></QueryClientProvider>)
}

const rowOf = (scope: HTMLElement, name: string) =>
  within(scope).getByRole('button', { name: `Remove ${name}` }).closest('[data-slot="field-row"]') as HTMLElement

describe('RosterTab', () => {
  it('prints the numeric column labels once per field instead of a badge on every row', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    expect(within(pool).getAllByText('Age')).toHaveLength(1)
    expect(within(pool).getAllByText('lb')).toHaveLength(1)
    expect(within(pool).queryByText('missing age')).not.toBeInTheDocument()
    expect(within(pool).queryByText('missing weight')).not.toBeInTheDocument()
    expect(within(pool).queryByText('estimated')).not.toBeInTheDocument()
  })

  it('renders a missing number as an attend dash in its own track and an estimated one as dotted', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    const age = within(pool).getByRole('button', { name: 'Age for Noah Kid, missing' })
    expect(age).toHaveTextContent('--')
    expect(age.className).toContain('text-attend')
    const weight = within(pool).getByRole('button', { name: 'Weight for Zoe Kid, 60' })
    expect(weight).toHaveTextContent('60')
    expect(weight.className).toContain('decoration-dotted')
    expect(weight).toHaveAttribute('title')
    expect(rowOf(pool, 'Noah Kid')).toHaveAttribute('data-state', 'attend')
  })

  it('lays the row out on the Ledger Grid with the name titled and the meta line free of numbers', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    const row = rowOf(pool, 'Zoe Kid')
    expect(row.className).toContain('grid-cols-[var(--col-select)_var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)_var(--col-act)]')
    expect(row.className).toContain('h-14')
    expect(within(row).getByText('Zoe Kid')).toHaveAttribute('title', 'Zoe Kid')
    expect(within(row).getByText('Grey · M · ERP 5.2')).toBeInTheDocument()
  })

  it('becomes one field below 1280 and three columns above it', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const grid = screen.getByRole('region', { name: 'Ridgeline' }).parentElement
    expect(grid?.className).toContain('xl:grid-cols-3')
    expect(grid?.className).not.toContain('lg:grid-cols-2')
    const heads = Array.from(document.querySelectorAll('[data-slot="field-head"]'))
    expect(heads).toHaveLength(3)
    expect(heads[0].className).not.toContain('hidden')
    expect(heads[1].className).toContain('hidden xl:grid')
    expect(heads[2].className).toContain('hidden xl:grid')
  })

  it('shows the sync button only before a pool has ever been imported', () => {
    fakeFetch(() => ({ json: [] }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={qc}><RosterTab detail={detail} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Sync from WellnessLiving' })).toBeInTheDocument()
    rerender(<QueryClientProvider client={qc}><RosterTab detail={{ ...detail, candidateCount: 12 }} /></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: 'Sync from WellnessLiving' })).not.toBeInTheDocument()
  })

  it('replaces the toolbar with one selection bar and assigns from it', async () => {
    const f = fakeFetch(() => ({ json: [] }))
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    const bar = screen.getByRole('group', { name: 'Selection' })
    expect(within(bar).getByText('2', { selector: 'span.fig' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add competitor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move 2 here' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Move to Lakeside' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/athletes/assign')).toBe(true))
    const i = f.calls.findIndex(c => c.url === '/api/events/7/athletes/assign')
    expect(f.body(i)).toEqual({ ids: [300, 400], teamId: 2 })
  })

  it('extends the selection over a shift-click range', async () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const user = userEvent.setup()
    const teamA = screen.getByRole('region', { name: 'Ridgeline' })
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(teamA).getByRole('checkbox', { name: 'Select Mateo Kid' }))
    await user.keyboard('{Shift>}')
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    await user.keyboard('{/Shift}')
    const bar = screen.getByRole('group', { name: 'Selection' })
    expect(within(bar).getByText('3', { selector: 'span.fig' })).toBeInTheDocument()
    expect(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' })).toBeChecked()
  })

  it('shows the server error when an assign fails, and keeps it while the selection stands', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Move to Lakeside' }))
    // The Alert primitive, not a bare red paragraph: a title naming the failed action
    // plus the server sentence, each in its own slot.
    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('The move failed')
    expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('teamId is not on this event')
  })

  /**
   * A react-query mutation holds its error until that same mutation runs again, so a
   * banner rendered as `assign.error ?? patch.error` was pinned to whichever failed
   * FIRST. A move refused at 10:00 still read "The move failed" over a weight edit
   * refused ten minutes later for a different reason, and there is no dismiss: the
   * operator read the wrong reason for the wrong action.
   */
  it('shows the newer failure, under the title of the action that actually failed', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/events/7/athletes/assign' && init?.method === 'POST') {
        return { status: 422, json: { error: { code: 'validation', message: 'teamId is not on this event' } } }
      }
      if (url === '/api/athletes/400' && init?.method === 'PATCH') {
        return { status: 422, json: { error: { code: 'validation', message: 'age must be between 3 and 17' } } }
      }
      return { json: [] }
    })
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(screen.getByRole('button', { name: 'Move to Lakeside' }))
    const first = await screen.findByRole('alert')
    expect(first.querySelector('[data-slot="alert-title"]')).toHaveTextContent('The move failed')

    // The operator leaves it standing and edits a weight, which is refused for its own
    // reason. The assign error is still non-null underneath.
    await user.click(within(pool).getByRole('button', { name: 'Age for Zoe Kid, 8' }))
    await user.type(within(pool).getByLabelText('Age for Zoe Kid'), '2')
    await user.tab()

    await vi.waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('The edit was not saved')
      expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('age must be between 3 and 17')
    })
    expect(screen.queryByText('teamId is not on this event')).not.toBeInTheDocument()
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

  it('removes every selected competitor from the selection bar', async () => {
    const f = fakeFetch((_url, init) => (init?.method === 'DELETE' ? { status: 204 } : { json: [] }))
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove 2 competitors?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(() => {
      const deletes = f.calls.filter(c => c.init?.method === 'DELETE').map(c => c.url)
      expect(deletes).toEqual(['/api/athletes/300', '/api/athletes/400'])
    })
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
    await user.click(within(pool).getByRole('button', { name: 'Age for Noah Kid, missing' }))
    await user.type(within(pool).getByLabelText('Age for Noah Kid'), '9')
    await user.tab()
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/athletes/300')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/athletes/300'))).toEqual({ age: 9 })
  })

  it('reverts an inline edit on Escape and writes nothing', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('button', { name: 'Age for Noah Kid, missing' }))
    await user.type(within(pool).getByLabelText('Age for Noah Kid'), '9')
    await user.keyboard('{Escape}')
    expect(within(pool).getByRole('button', { name: 'Age for Noah Kid, missing' })).toHaveTextContent('--')
    expect(f.calls.some(c => c.url === '/api/athletes/300')).toBe(false)
  })

  it('marks the row fault when its inline edit is refused', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/athletes/400' && init?.method === 'PATCH') {
        return { status: 422, json: { error: { code: 'validation', message: 'age must be between 3 and 17' } } }
      }
      return { json: [] }
    })
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('button', { name: 'Age for Zoe Kid, 8' }))
    await user.type(within(pool).getByLabelText('Age for Zoe Kid'), '2')
    await user.tab()
    await vi.waitFor(() => expect(rowOf(pool, 'Zoe Kid')).toHaveAttribute('data-state', 'fault'))
  })

  it('moves a competitor on a pointer drag, and draws the field boundaries while it runs', async () => {
    const f = fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    const row = rowOf(pool, 'Noah Kid')
    const target = document.querySelector('[data-drop-team="2"]') as HTMLElement
    ;(document as Partial<Document>).elementFromPoint = () => target
    const tab = document.querySelector('[data-dragging]') as HTMLElement

    fireEvent.pointerDown(within(row).getByText('Noah Kid'), { clientX: 0, clientY: 0 })
    expect(tab).toHaveAttribute('data-dragging', 'false')
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0 })
    expect(tab).toHaveAttribute('data-dragging', 'true')
    fireEvent.pointerUp(window, { clientX: 200, clientY: 0 })
    expect(tab).toHaveAttribute('data-dragging', 'false')

    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/athletes/assign')).toBe(true))
    const i = f.calls.findIndex(c => c.url === '/api/events/7/athletes/assign')
    expect(f.body(i)).toEqual({ ids: [300], teamId: 2 })
  })

  it('does not start a drag from a press that never travels', () => {
    const f = fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    const row = rowOf(pool, 'Noah Kid')
    const target = document.querySelector('[data-drop-team="2"]') as HTMLElement
    ;(document as Partial<Document>).elementFromPoint = () => target
    fireEvent.pointerDown(within(row).getByText('Noah Kid'), { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 3, clientY: 0 })
    fireEvent.pointerUp(window, { clientX: 3, clientY: 0 })
    expect(f.calls.some(c => c.url === '/api/events/7/athletes/assign')).toBe(false)
  })

  // An aria-label REPLACES the name computed from the contents, so labelling the column
  // discarded the number. A screen reader user could not find the missing weights, which
  // is the one task this screen exists for.
  it('speaks the number in the cell name, with an explicit word for a missing one', () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    expect(within(pool).getByRole('button', { name: 'Age for Noah Kid, missing' })).toBeInTheDocument()
    expect(within(pool).getByRole('button', { name: 'Weight for Noah Kid, 60' })).toBeInTheDocument()
    expect(within(pool).getByRole('button', { name: 'Age for Zoe Kid, 8' })).toBeInTheDocument()
    // The column-only name is gone: nothing may be named without its value again.
    expect(within(pool).queryByRole('button', { name: 'Age for Noah Kid' })).not.toBeInTheDocument()
    expect(within(pool).queryByRole('button', { name: 'Weight for Zoe Kid' })).not.toBeInTheDocument()
  })

  it('refuses the row remove for a competitor already in a match and prints the reason on the row', () => {
    fakeFetch(() => ({ json: [] }))
    mount(placed)
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    expect(within(pool).getByRole('button', { name: 'Remove Noah Kid, already in a match' })).toBeDisabled()
    expect(within(pool).getByText('Grey · M · unrated · In a match')).toBeInTheDocument()
    expect(within(pool).getByRole('button', { name: 'Remove Zoe Kid' })).toBeEnabled()
  })

  it('drops the blocked competitors from a bulk remove and prints how many it dropped', async () => {
    const f = fakeFetch((_url, init) => (init?.method === 'DELETE' ? { status: 204 } : { json: [] }))
    mount(placed)
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    const bar = screen.getByRole('group', { name: 'Selection' })
    expect(bar).toHaveTextContent('1 already in a match')
    await user.click(within(bar).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    // Noah never entered the set, so the dialog counts one and the loop cannot stall on him.
    expect(within(dialog).getByText('Remove Zoe Kid?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(() => {
      expect(f.calls.filter(c => c.init?.method === 'DELETE').map(c => c.url)).toEqual(['/api/athletes/400'])
    })
  })

  it('refuses a bulk remove outright when every selected competitor is in a match', async () => {
    fakeFetch(() => ({ json: [] }))
    mount(placed)
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    const bar = screen.getByRole('group', { name: 'Selection' })
    expect(within(bar).getByRole('button', { name: 'Remove' })).toBeDisabled()
  })

  it('names the competitor a bulk remove stopped on and keeps the successes out of the retry', async () => {
    const f = fakeFetch((url, init) => {
      if (init?.method !== 'DELETE') return { json: [] }
      if (url === '/api/athletes/400') {
        return { status: 409, json: { error: { code: 'match_state', message: 'athlete is in a match; delete the match first' } } }
      }
      return { status: 204 }
    })
    mount()
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove 2 competitors?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    // The raw server message names no competitor, which on a bulk remove is the only
    // fact the organizer needs, so the Alert title carries it and the description
    // carries the server's own sentence untouched.
    const alert = await within(dialog).findByRole('alert')
    expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('Zoe Kid was not removed')
    expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('athlete is in a match; delete the match first')
    expect(within(dialog).getByText('Remove Zoe Kid?')).toBeInTheDocument()
    const before = f.calls.filter(c => c.init?.method === 'DELETE').length
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(() => expect(f.calls.filter(c => c.init?.method === 'DELETE').length).toBe(before + 1))
    // The retry re-issues only the one that failed.
    expect(f.calls.filter(c => c.url === '/api/athletes/300' && c.init?.method === 'DELETE')).toHaveLength(1)
  })

  it('announces the selection in one polite region that is present and empty from the first render', async () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const regions = document.querySelectorAll('[aria-live="polite"]')
    expect(regions).toHaveLength(1)
    const region = regions[0]
    expect(region.textContent).toBe('')
    const user = userEvent.setup()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    // The same node, so the announcement is a text change inside a standing region and
    // not a region mounted on demand, which a screen reader would never read.
    expect(region.textContent).toBe('1 competitor selected.')
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Zoe Kid' }))
    expect(region.textContent).toBe('2 competitors selected.')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(region.textContent).toBe('')
  })

  // jsdom applies no stylesheet, so the layer each element lands in is read from the
  // utilities themselves. What makes this a real check rather than a string compare is
  // that the two sides come from two different files: it fails if the shell's header
  // drops to the subhead's level, or the subhead climbs to the header's.
  it('pins the team subhead below the app header instead of over it', () => {
    const level = (el: Element): number => {
      const hit = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(el.className)
      return hit ? Number(hit[1]) : 0
    }
    fakeFetch(() => ({ json: [] }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AdminShell title="Fall Duels"><RosterTab detail={detail} /></AdminShell>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const header = document.querySelector('header')!
    const subhead = screen.getByRole('region', { name: 'Unassigned' }).firstElementChild!
    expect(subhead.className).toContain('sticky')
    expect(level(subhead)).toBeGreaterThan(0)
    expect(level(subhead)).toBeLessThan(level(header))
    // And it clears the header rather than pinning to the same edge.
    expect(subhead.className).not.toContain('top-0')
    expect(subhead.className).toContain('top-[var(--app-header-h,57px)]')
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
