import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo'), kid(200, 2, 'Olivia'), kid(300, null, 'Noah', { age: null, ageSource: null }), kid(400, null, 'Zoe', { weightSource: 'leaderboard', erp: 5.2 })],
  rulesets: [], mats: [], matches: [], candidateCount: 0,
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RosterTab detail={detail} /></QueryClientProvider>)
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
    const age = within(pool).getByRole('button', { name: 'Age for Noah Kid' })
    expect(age).toHaveTextContent('--')
    expect(age.className).toContain('text-attend')
    const weight = within(pool).getByRole('button', { name: 'Weight for Zoe Kid' })
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
    await user.click(within(pool).getByRole('button', { name: 'Age for Noah Kid' }))
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
    await user.click(within(pool).getByRole('button', { name: 'Age for Noah Kid' }))
    await user.type(within(pool).getByLabelText('Age for Noah Kid'), '9')
    await user.keyboard('{Escape}')
    expect(within(pool).getByRole('button', { name: 'Age for Noah Kid' })).toHaveTextContent('--')
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
    await user.click(within(pool).getByRole('button', { name: 'Age for Zoe Kid' }))
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
