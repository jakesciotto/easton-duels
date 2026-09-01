import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewEventDialog } from '@/routes/admin/NewEventDialog'
import { MODE_GROUP_LABEL, MODE_HELP, MODE_LABEL, MODE_ORDER } from '@/lib/eventMode'
import { setAdminToken } from '@/lib/auth'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><NewEventDialog open onOpenChange={() => {}} onCreated={() => {}} /></QueryClientProvider>)
}

const grid = (name: string) => screen.getByRole('radiogroup', { name })

describe('NewEventDialog', () => {
  it('disables the partners 2.4 blocks and leaves the far hues alone', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    // Team A holds Crimson, so Team B's grid blocks its two hue neighbours plus the two
    // that collapse onto it under dichromacy, and nothing else.
    const b = grid('Team B colour')
    for (const name of ['Amber', 'Magenta', 'Citron', 'Green']) {
      expect(within(b).getByRole('radio', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    for (const name of ['Azure', 'Teal', 'Violet']) {
      expect(within(b).getByRole('radio', { name })).not.toHaveAttribute('aria-disabled')
    }
  })

  it('names the conflict instead of silently refusing, and keeps the colour it had', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.click(within(grid('Team B colour')).getByRole('radio', { name: 'Amber' }))
    expect(screen.getByText('Crimson and Amber look the same from the back of the gym. Try Azure or Teal.')).toBeInTheDocument()
    expect(within(grid('Team B colour')).getByRole('radio', { name: 'Azure' })).toBeChecked()
  })

  it('takes a legal colour and posts it', async () => {
    const f = fakeFetch((url, init) => (url === '/api/events' && init?.method === 'POST' ? { status: 201, json: {} } : { json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.click(within(grid('Team B colour')).getByRole('radio', { name: 'Teal' }))
    await user.click(screen.getByRole('button', { name: 'Create event' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.init?.method === 'POST'))
    expect(body.teams).toEqual([{ name: 'Ridgeline', color: 'red' }, { name: 'Lakeside', color: 'teal' }])
    expect(body).toMatchObject({ matCount: 1, maxAgeGap: 1, maxWeightGap: 10 })
  })

  it('previews the board code from the name as it is typed', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    expect(screen.getAllByText('RID').length).toBeGreaterThan(0)
  })

  // One vocabulary and one order for the one setting. This dialog said "Live scoring"
  // then "Data entry" while the event shell said "Runs from the desk" then "Scored on
  // mats": different words, opposite order, on the two screens an organizer moves between
  // on the morning of the event. Both now render the same exported list, so a reordering
  // or a rewording of either one breaks here.
  it('names the two ways an event runs in the shared words and order, and posts the choice', async () => {
    const f = fakeFetch((url, init) => (url === '/api/events' && init?.method === 'POST' ? { status: 201, json: {} } : { json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    const modeGrid = grid(MODE_GROUP_LABEL)
    expect(within(modeGrid).getAllByRole('radio').map(r => r.getAttribute('aria-label')))
      .toEqual(MODE_ORDER.map(m => MODE_LABEL[m]))
    expect(within(modeGrid).getByRole('radio', { name: MODE_LABEL.live })).toBeChecked()
    expect(screen.getByText(MODE_HELP.live)).toBeInTheDocument()
    await user.click(within(modeGrid).getByRole('radio', { name: MODE_LABEL.entry }))
    expect(screen.getByText(MODE_HELP.entry)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.click(screen.getByRole('button', { name: 'Create event' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.init?.method === 'POST'))
    expect(body.mode).toBe('entry')
  })

  it('refuses to submit a count outside the range the server accepts', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    const mats = screen.getByLabelText('Mats')
    await user.clear(mats)
    await user.type(mats, '12')
    expect(mats).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Create event' })).toBeDisabled()
  })
})
