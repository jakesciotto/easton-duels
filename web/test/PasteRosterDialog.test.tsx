import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PasteRosterDialog } from '@/routes/event/PasteRosterDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }],
  athletes: [], rulesets: [], mats: [], matches: [], candidateCount: 0,
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><PasteRosterDialog detail={detail} open onOpenChange={() => {}} /></QueryClientProvider>)
}

const rows = () => screen.getAllByRole('row').slice(1)

describe('PasteRosterDialog', () => {
  it('previews every line in the shared table', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    await userEvent.setup().type(screen.getByLabelText('Roster text'), 'Mateo Rivera, 8, 62, grey, M')
    const cells = within(rows()[0]).getAllByRole('cell').map(c => c.textContent)
    expect(cells).toEqual(['', '1', 'Mateo Rivera', '8', '62', 'Grey', 'M'])
  })

  it('renders a parse error against its own line rather than as a detached list', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    // Line 2 is the bad one, so line 1 has to keep its own parsed row and line 2 has to
    // carry the message: a list above the table cannot say which line it is about.
    await userEvent.setup().type(screen.getByLabelText('Roster text'), 'Mateo Rivera, 8{Enter}Olivia, 8')
    expect(within(rows()[0]).getByText('Mateo Rivera')).toBeInTheDocument()
    const bad = rows()[1]
    expect(within(bad).getByText('2')).toBeInTheDocument()
    expect(within(bad).getByText('needs a first and last name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add 0 competitors/ })).toBeDisabled()
  })

  it('does not nest a second scroll container around the preview table (finding 4)', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    await userEvent.setup().type(screen.getByLabelText('Roster text'), 'Mateo Rivera, 8, 62, grey, M')
    const table = screen.getByRole('table')
    // Table's own div is the single scrollport now (finding 4's fix folds the caller's
    // vertical scroll into it via wrapperClassName), carrying the preview's own
    // max-h-[224px]. The dialog body further out is a separate, legitimate scroller
    // for the whole dialog at its own, different max-height; what must NOT exist is a
    // second 224px-constrained wrapper directly around the table -- that was the old
    // bug, and it is what stranded the sticky head on a scrollport with no room of
    // its own.
    const wrapper = table.parentElement as HTMLElement
    expect(wrapper.className).toMatch(/max-h-\[224px\]/)
    expect(wrapper.className).toMatch(/overflow-y-auto/)
    expect(wrapper.parentElement?.className ?? '').not.toMatch(/max-h-\[224px\]/)
  })

  it('posts every parsed row on the chosen team', async () => {
    const f = fakeFetch(() => ({ status: 201, json: [] }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Roster text'), 'Mateo Rivera, 8, 62, grey, M')
    await user.click(screen.getByRole('button', { name: 'Add 1 competitor' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.init?.method === 'POST'))).toEqual({
      bulk: [{ firstName: 'Mateo', lastName: 'Rivera', age: 8, weightLbs: 62, belt: 'grey', gender: 'M', teamId: null }],
    })
  })
})
