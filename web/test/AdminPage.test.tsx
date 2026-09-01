import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { setAdminToken } from '@/lib/auth'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

function mount(path = '/admin') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

const summary = { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x',
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }] }

describe('AdminPage', () => {
  it('lists events with their teams and opens one from the event name link', async () => {
    fakeFetch(url => url === '/api/events' ? { json: [summary] } : { json: { event: summary, teams: summary.teams, athletes: [], rulesets: [], mats: [], matches: [] } })
    const router = mount()
    expect(await screen.findByText('Fall Duels')).toBeInTheDocument()
    expect(screen.getByText('Ridgeline')).toBeInTheDocument()
    expect(screen.getByText('Lakeside')).toBeInTheDocument()
    // 6.2: the event name is the row's own link target, so "Open" no longer exists --
    // only "Board" remains as a separate action.
    expect(screen.queryByRole('link', { name: /open/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('link', { name: 'Fall Duels' }))
    expect(router.state.location.pathname).toBe('/events/7')
  })

  it('creates an event from the dialog and navigates to it', async () => {
    const f = fakeFetch((url, init) => {
      if (url === '/api/events' && init?.method === 'POST') return { status: 201, json: { event: { ...summary, id: 9 }, teams: summary.teams, athletes: [], rulesets: [], mats: [], matches: [] } }
      if (url === '/api/events') return { json: [] }
      return { json: { event: { ...summary, id: 9 }, teams: summary.teams, athletes: [], rulesets: [], mats: [], matches: [] } }
    })
    const router = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New event' }))
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.clear(screen.getByLabelText('Date'))
    await user.type(screen.getByLabelText('Date'), '2026-10-03')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.click(screen.getByRole('button', { name: 'Create event' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/events/9'))
    const posted = f.body(f.calls.findIndex(c => c.init?.method === 'POST'))
    expect(posted).toMatchObject({ name: 'Fall Duels', date: '2026-10-03', matCount: 1, teams: [{ name: 'Ridgeline', color: 'red' }, { name: 'Lakeside', color: 'blue' }] })
  })

  it('resets the new event form when reopened after cancel', async () => {
    fakeFetch(url => url === '/api/events' ? { json: [] } : { json: { event: summary, teams: summary.teams, athletes: [], rulesets: [], mats: [], matches: [] } })
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New event' }))
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    expect(screen.getByLabelText('Event name')).toHaveValue('Fall Duels')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'New event' }))
    expect(await screen.findByLabelText('Event name')).toHaveValue('')
  })

  it('renders a validation error from the server without an unhandled rejection', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/events' && init?.method === 'POST') return { status: 422, json: { error: { code: 'validation', message: 'name required' } } }
      if (url === '/api/events') return { json: [] }
      return { json: { event: summary, teams: summary.teams, athletes: [], rulesets: [], mats: [], matches: [] } }
    })
    const router = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New event' }))
    await user.type(screen.getByLabelText('Event name'), 'Fall Duels')
    await user.type(screen.getByLabelText('Team A name'), 'Ridgeline')
    await user.type(screen.getByLabelText('Team B name'), 'Lakeside')
    await user.click(screen.getByRole('button', { name: 'Create event' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('name required')
    expect(router.state.location.pathname).toBe('/admin')
  })
})
