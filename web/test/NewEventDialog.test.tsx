import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewEventDialog } from '@/routes/admin/NewEventDialog'
import { MODE_GROUP_LABEL, MODE_HELP, MODE_LABEL, MODE_ORDER } from '@/lib/eventMode'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

function mount(onCreated: (d: EventDetail) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><NewEventDialog open onOpenChange={() => {}} onCreated={onCreated} /></QueryClientProvider>)
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.init?.method === 'POST'))
    expect(body.teams).toEqual([{ name: 'Ridgeline', color: 'red' }, { name: 'Lakeside', color: 'teal' }])
    expect(body).toMatchObject({ matCount: 1 })
    expect(body).not.toHaveProperty('maxAgeGap')
    expect(body).not.toHaveProperty('maxWeightGap')
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.init?.method === 'POST'))
    expect(body.mode).toBe('entry')
  })

  /**
   * G09 / 6.4. Event-night volunteer practice requires every volunteer to have a named
   * person to escalate to, and no screen in the product named one. The pair is optional
   * here because on the morning an event is created nobody has decided who is running the
   * desk yet, so the event shell can set it later; what matters is that an organizer who
   * does know is asked once, at the one moment they are filling the event in.
   */
  it('carries an optional desk contact into the create body', async () => {
    const f = fakeFetch((url, init) => (url === '/api/events' && init?.method === 'POST' ? { status: 201, json: {} } : { json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.type(screen.getByLabelText('Desk contact (optional)'), 'Sam Whitfield')
    await user.type(screen.getByLabelText('Phone'), '555-0142')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.init?.method === 'POST')))
      .toMatchObject({ contactName: 'Sam Whitfield', contactPhone: '555-0142' })
  })

  it('sends the pair as empty when nobody filled it in, which the server reads as none', async () => {
    const f = fakeFetch((url, init) => (url === '/api/events' && init?.method === 'POST' ? { status: 201, json: {} } : { json: {} }))
    mount()
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.init?.method === 'POST')))
      .toMatchObject({ contactName: '', contactPhone: '' })
  })

  /**
   * B3. Creating the event is step one of three, and the primary says so: an organizer who
   * pressed "Create event" had no way to know that a roster and a running order were still
   * waiting for them, and the two screens that carry those steps were reachable only by
   * knowing the tabs were there.
   */
  it('names the next step on the primary and marks itself step one of three', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument()
    const steps = screen.getByRole('list', { name: 'Setup steps' })
    expect(within(steps).getAllByRole('listitem').map(li => li.textContent)).toEqual(['1 Event', '2 Roster', '3 Matches'])
    expect(within(steps).getByText('1 Event')).toHaveAttribute('aria-current', 'step')
  })

  // The created event is what the caller navigates to, so the id it carries is the whole
  // handoff into the roster step.
  it('hands the created event to the caller so the roster step can open on it', async () => {
    const created = { event: { id: 9 }, teams: [], athletes: [], rulesets: [], mats: [], matches: [], candidateCount: 0 }
    fakeFetch((url, init) => (url === '/api/events' && init?.method === 'POST' ? { status: 201, json: created } : { json: {} }))
    const onCreated = vi.fn()
    mount(onCreated)
    const user = userEvent.setup()
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(onCreated.mock.calls[0][0].event.id).toBe(9)
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
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })
})
