import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminShell } from '@/components/AdminShell'
import { RosterTab } from '@/routes/event/RosterTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, SyncReport } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).elementFromPoint
})

const kid = (id: number, teamId: number | null, first: string, over: Partial<EventDetail['athletes'][number]> = {}): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: 'Kid', age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [], ...over,
})
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', mode: 'live', sameGender: false, createdAt: 'x' },
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
    pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null, source: 'designed',
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
    // The Link track, then two action tracks: the profile every row carries, then the remove.
    expect(row.className).toContain('grid-cols-[var(--col-select)_var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)_56px_var(--col-act)_var(--col-act)]')
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

  // 7.1: one press, offered whether or not a pool has ever been pulled. An event with no
  // WellnessLiving behind it is told so by the dialog, not by a button that is not there.
  it('always offers the sync', () => {
    fakeFetch(() => ({ json: [] }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={qc}><RosterTab detail={detail} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Sync from WellnessLiving' })).toBeInTheDocument()
    rerender(<QueryClientProvider client={qc}><RosterTab detail={{ ...detail, candidateCount: 12 }} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Sync from WellnessLiving' })).toBeInTheDocument()
  })

  it('opens the profile sheet from every row', async () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    const pool = screen.getByRole('region', { name: 'Unassigned' })
    expect(within(pool).getByRole('button', { name: 'Profile for Noah Kid' })).toBeInTheDocument()
    expect(within(pool).getByRole('button', { name: 'Profile for Zoe Kid' })).toBeInTheDocument()
    await userEvent.setup().click(within(pool).getByRole('button', { name: 'Profile for Zoe Kid' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Zoe Kid')).toBeInTheDocument()
    expect(within(dialog).getByText('Last synced')).toBeInTheDocument()
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

/**
 * Spec 5.3. The gym's records overwrite the paste, so the roster is where a competitor
 * that WellnessLiving has never heard of has to say so, and where the organizer picks the
 * right person by hand when the pool holds two of a name or none.
 */
describe('RosterTab, the WellnessLiving link', () => {
  const POOL = [
    { wlUid: 'w1', firstName: 'Mateo', lastName: 'Kidd', belt: 'grey', wlLocation: 'Boulder', leaderboardId: 'mateo-kidd', erp: 5.2, age: 8, weightLbs: 62, gender: 'M' },
    { wlUid: 'w2', firstName: 'Priya', lastName: 'Shah', belt: 'grey-white', wlLocation: 'Denver', leaderboardId: null, erp: null, age: 9, weightLbs: 70, gender: 'F' },
    { wlUid: 'w3', firstName: 'Olive', lastName: 'Kidd', belt: 'grey', wlLocation: 'Boulder', leaderboardId: 'olive-kidd', erp: 4.1, age: 8, weightLbs: 61, gender: 'F' },
  ]
  const CLEAN: SyncReport = { linked: [], refreshed: 0, changed: [], suggested: [], ambiguous: [], unmatched: [], gone: [] }

  // Mateo is linked already; the other three are not, which is what the pool exists for.
  const pooled: EventDetail = {
    ...detail,
    athletes: [
      kid(100, 1, 'Mateo', { wlUid: 'w1', wlLocation: 'Boulder' }),
      kid(200, 2, 'Olivia'),
      kid(300, null, 'Noah', { age: null, ageSource: null }),
      kid(400, null, 'Zoe', { weightSource: 'leaderboard', erp: 5.2 }),
    ],
    candidateCount: 2,
  }

  // 7.1: the sync is one press with no pool button beside it. The pool-only rematch route
  // stays for the API, but nothing on this screen calls it.
  it('offers no separate match button once a pool exists', () => {
    fakeFetch(() => ({ json: [] }))
    mount(pooled)
    expect(screen.queryByRole('button', { name: 'Match to WellnessLiving' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync from WellnessLiving' })).toBeInTheDocument()
  })

  it('reports what the sync did once the dialog closes, and clears it on the next roster write', async () => {
    fakeFetch((url, init) => {
      if (url.endsWith('/roster/sync') && init?.method === 'POST') {
        return { json: { candidates: [], warnings: [], report: { ...CLEAN, linked: ['Olivia Kid'], unmatched: ['Noah Kid'] } } }
      }
      return { json: [] }
    })
    mount(pooled)
    const user = userEvent.setup()
    // The dialog syncs as soon as it opens, so the press on the tab is the whole gesture.
    await user.click(screen.getByRole('button', { name: 'Sync from WellnessLiving' }))
    await screen.findByText('Linked 1. Refreshed 0, 0 changed.')

    // The dialog covers the rows the report names, so the tab is where it stands.
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Not found: Noah Kid.')).toBeInTheDocument()

    const pool = screen.getByRole('region', { name: 'Unassigned' })
    await user.click(within(pool).getByRole('checkbox', { name: 'Select Noah Kid' }))
    await user.click(screen.getByRole('button', { name: 'Move to Ridgeline' }))
    await vi.waitFor(() => expect(screen.queryByText('Not found: Noah Kid.')).not.toBeInTheDocument())
  })

  /**
   * Spec 2 and 7.3. A near match never links itself. The row names the candidate it points
   * at and hands the decision to a person, twice over: Confirm links it, Not them says the
   * candidate is somebody else and the row falls back to the pool picker.
   */
  describe('a suggestion waiting on a person', () => {
    const suggested: EventDetail = {
      ...pooled,
      athletes: [
        kid(100, 1, 'Mateo', { wlUid: 'w1', wlLocation: 'Boulder' }),
        kid(200, 2, 'Olivia', { suggestedWlUid: 'w3', suggestedScore: 0.82 }),
        kid(300, null, 'Noah', { age: null, ageSource: null }),
        kid(400, null, 'Zoe', { weightSource: 'leaderboard', erp: 5.2 }),
      ],
    }
    const withPool = () => fakeFetch((url, init) => {
      if (url === '/api/events/7/candidates') return { json: POOL }
      if (init?.method === 'POST') return { json: {} }
      return { json: [] }
    })

    it('names the candidate on the meta line and offers both answers', async () => {
      withPool()
      mount(suggested)
      const teamB = screen.getByRole('region', { name: 'Lakeside' })
      expect(await within(teamB).findByText(/Looks like Olive Kidd, Boulder/)).toBeInTheDocument()
      expect(within(teamB).getByRole('button', { name: 'Confirm Olivia Kid' })).toBeInTheDocument()
      expect(within(teamB).getByRole('button', { name: 'Not them, Olivia Kid' })).toBeInTheDocument()
      // The row is waiting on a person, so it does not also claim to be missing.
      expect(within(teamB).queryByText(/Not in WellnessLiving/)).not.toBeInTheDocument()
      expect(within(teamB).queryByRole('button', { name: 'Link Olivia Kid' })).not.toBeInTheDocument()
    })

    it('links the candidate on Confirm', async () => {
      const f = withPool()
      mount(suggested)
      const teamB = screen.getByRole('region', { name: 'Lakeside' })
      await userEvent.setup().click(within(teamB).getByRole('button', { name: 'Confirm Olivia Kid' }))
      await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/athletes/200/link')).toBe(true))
      expect(f.body(f.calls.findIndex(c => c.url === '/api/athletes/200/link'))).toEqual({ wlUid: 'w3' })
    })

    it('dismisses the candidate on Not them', async () => {
      const f = withPool()
      mount(suggested)
      const teamB = screen.getByRole('region', { name: 'Lakeside' })
      await userEvent.setup().click(within(teamB).getByRole('button', { name: 'Not them, Olivia Kid' }))
      await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/athletes/200/dismiss')).toBe(true))
      expect(f.body(f.calls.findIndex(c => c.url === '/api/athletes/200/dismiss'))).toEqual({ wlUid: 'w3' })
    })

    it('reads a refused confirm under the toolbar', async () => {
      fakeFetch((url, init) => {
        if (url === '/api/events/7/candidates') return { json: POOL }
        if (url === '/api/athletes/200/link' && init?.method === 'POST') {
          return { status: 409, json: { error: { code: 'duplicate', message: 'Olive Kidd is already on the roster' } } }
        }
        return { json: [] }
      })
      mount(suggested)
      const teamB = screen.getByRole('region', { name: 'Lakeside' })
      await userEvent.setup().click(within(teamB).getByRole('button', { name: 'Confirm Olivia Kid' }))
      const alert = await screen.findByRole('alert')
      expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('That competitor was not linked')
      expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('Olive Kidd is already on the roster')
    })

    it('says so when the pool the candidate lives in cannot be read', async () => {
      fakeFetch(url => {
        if (url === '/api/events/7/candidates') {
          return { status: 503, json: { error: { code: 'wl_error', message: 'WellnessLiving did not answer' } } }
        }
        return { json: [] }
      })
      mount(suggested)
      const alert = await screen.findByRole('alert')
      expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('The WellnessLiving pool did not load')
      // The uid is stored, so the two answers still stand without the name.
      const teamB = screen.getByRole('region', { name: 'Lakeside' })
      expect(within(teamB).getByRole('button', { name: 'Confirm Olivia Kid' })).toBeInTheDocument()
      expect(within(teamB).queryByText(/Looks like/)).not.toBeInTheDocument()
    })

    // A roster with no suggestion on it has nothing to look up.
    it('does not read the pool when no row is waiting', () => {
      const f = fakeFetch(() => ({ json: [] }))
      mount(pooled)
      expect(f.calls.some(c => c.url === '/api/events/7/candidates')).toBe(false)
    })
  })

  // Spec 4. The pool is the subset the last sync found, so an empty one no longer means
  // there is nobody to link to: the picker asks WellnessLiving by name either way.
  it('offers Link on every unlinked row with no suggestion, whatever the pool holds', () => {
    fakeFetch(() => ({ json: [] }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={qc}><RosterTab detail={pooled} /></QueryClientProvider>)
    const teamA = screen.getByRole('region', { name: 'Ridgeline' })
    const teamB = screen.getByRole('region', { name: 'Lakeside' })
    expect(within(teamA).queryByRole('button', { name: 'Link Mateo Kid' })).not.toBeInTheDocument()
    expect(within(teamB).getByRole('button', { name: 'Link Olivia Kid' })).toBeInTheDocument()

    rerender(<QueryClientProvider client={qc}><RosterTab detail={{ ...pooled, candidateCount: 0 }} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Link Olivia Kid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link Noah Kid' })).toBeInTheDocument()
  })

  // A sync stamps every row it considered, so the word is an answer rather than a guess
  // about a roster nothing has looked up yet.
  it('says a row is not in WellnessLiving only once a sync has looked', () => {
    fakeFetch(() => ({ json: [] }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(<QueryClientProvider client={qc}><RosterTab detail={pooled} /></QueryClientProvider>)
    expect(screen.queryByText(/Not in WellnessLiving/)).not.toBeInTheDocument()

    const looked = { ...pooled, athletes: pooled.athletes.map(a => ({ ...a, syncedAt: '2026-10-03T16:00:00.000Z' })) }
    rerender(<QueryClientProvider client={qc}><RosterTab detail={looked} /></QueryClientProvider>)
    const teamA = screen.getByRole('region', { name: 'Ridgeline' })
    const teamB = screen.getByRole('region', { name: 'Lakeside' })
    // Mateo is linked, so the sync found him.
    expect(within(teamA).queryByText(/Not in WellnessLiving/)).not.toBeInTheDocument()
    expect(within(teamB).getByText(/Not in WellnessLiving/)).toBeInTheDocument()
  })

  // Spec 4. The pool is the subset the last sync found, so the picker asks WellnessLiving
  // for the row's own last name and shows what comes back, in the order it comes back.
  const searching = (init?: RequestInit) => (url: string) => {
    if (url.startsWith('/api/events/7/wl-search')) return { json: [POOL[2], POOL[0], POOL[1]] }
    if (url === '/api/athletes/200/link' && init?.method === 'POST') return { json: {} }
    return { json: [] }
  }

  it('opens on the row last name, keeps the answer order, drops whoever is linked, and posts the pick', async () => {
    const f = fakeFetch((url, init) => searching(init)(url))
    mount(pooled)
    const user = userEvent.setup()
    const teamB = screen.getByRole('region', { name: 'Lakeside' })
    await user.click(within(teamB).getByRole('button', { name: 'Link Olivia Kid' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Link to WellnessLiving')).toBeInTheDocument()
    expect(within(dialog).getByText('Olivia Kid, Grey, 8, 60 lb')).toBeInTheDocument()
    // The field opens on the last name, which is the one word that needs no typing.
    expect(within(dialog).getByLabelText('Search')).toHaveValue('Kid')

    // Mateo Kidd is w1, which Mateo Kid already carries, so the picker never offers him.
    const rows = await vi.waitFor(() => {
      const found = within(dialog).getAllByRole('button', { name: /Link .* to Olivia Kid/ })
      expect(found).toHaveLength(2)
      return found
    })
    expect(f.calls.filter(c => c.url.includes('/wl-search')).at(-1)?.url).toBe('/api/events/7/wl-search?q=Kid')
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['Link Olive Kidd to Olivia Kid', 'Link Priya Shah to Olivia Kid'])

    await user.click(rows[0])
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/athletes/200/link')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/athletes/200/link'))).toEqual({ wlUid: 'w3' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks for two letters once the field is cleared', async () => {
    const f = fakeFetch((url, init) => searching(init)(url))
    mount(pooled)
    const user = userEvent.setup()
    const teamB = screen.getByRole('region', { name: 'Lakeside' })
    await user.click(within(teamB).getByRole('button', { name: 'Link Olivia Kid' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('button', { name: 'Link Olive Kidd to Olivia Kid' })

    const before = f.calls.filter(c => c.url.includes('/wl-search')).length
    await user.clear(within(dialog).getByLabelText('Search'))
    expect(await within(dialog).findByText('Type at least two letters.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Link .* to Olivia Kid/ })).not.toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(f.calls.filter(c => c.url.includes('/wl-search')).length).toBe(before)
  })

  it('reads a refused link inside the dialog', async () => {
    fakeFetch((url, init) => {
      if (url.startsWith('/api/events/7/wl-search')) return { json: POOL }
      if (url === '/api/athletes/200/link' && init?.method === 'POST') {
        return { status: 409, json: { error: { code: 'duplicate', message: 'Olive Kidd is already on the roster' } } }
      }
      return { json: [] }
    })
    mount(pooled)
    const user = userEvent.setup()
    const teamB = screen.getByRole('region', { name: 'Lakeside' })
    await user.click(within(teamB).getByRole('button', { name: 'Link Olivia Kid' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('button', { name: 'Link Olive Kidd to Olivia Kid' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Olive Kidd is already on the roster')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('reports a 503 from the search inside the dialog', async () => {
    fakeFetch(url => {
      if (url.startsWith('/api/events/7/wl-search')) {
        return { status: 503, json: { error: { code: 'wl_not_configured', message: 'WellnessLiving credentials are not set' } } }
      }
      return { json: [] }
    })
    mount(pooled)
    const teamB = screen.getByRole('region', { name: 'Lakeside' })
    await userEvent.setup().click(within(teamB).getByRole('button', { name: 'Link Olivia Kid' }))
    const dialog = await screen.findByRole('dialog')
    const alert = await within(dialog).findByRole('alert')
    expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('WellnessLiving did not answer')
    expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('credentials are not set')
  })
})
