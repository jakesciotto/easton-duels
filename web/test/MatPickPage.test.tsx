import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { getMatBinding, setMatBinding } from '@/lib/auth'
import { fakeFetch, FakeEventSource, sampleSnapshot } from './fakes'

beforeEach(() => localStorage.clear())
afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

function mount(path: string) {
  vi.stubGlobal('EventSource', FakeEventSource)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('MatPickPage', () => {
  it('lists mats from the board, binds with the code, stores the binding, and opens the scorer', async () => {
    const f = fakeFetch((url, init) => {
      if (url === '/api/events/1/board') return { json: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }, { id: 2, number: 2, current: null, onDeck: [], bound: false }] }) }
      if (url === '/api/events/1/mats/2/bind') return JSON.parse(String(init?.body)).code === '0420'
        ? { json: { token: 'mat-tok', mat: { id: 2, number: 2 }, event: { id: 1, name: 'Fall Duels' } } }
        : { status: 401, json: { error: { code: 'bad_code', message: 'wrong mat code' } } }
      return { json: {} }
    })
    const router = mount('/mat?event=1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Bind mat 2' }))
    await user.type(screen.getByLabelText('Mat code'), '9999')
    await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong mat code')
    await user.clear(screen.getByLabelText('Mat code'))
    await user.type(screen.getByLabelText('Mat code'), '0420')
    await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/mat/2'))
    expect(getMatBinding()).toEqual({ eventId: 1, matId: 2, matNumber: 2, eventName: 'Fall Duels', token: 'mat-tok' })
    expect(f.calls.some(c => c.url === '/api/events/1/mats/2/bind')).toBe(true)
  })

  it('offers to open or unbind an existing binding', async () => {
    fakeFetch(() => ({ json: {} }))
    setMatBinding({ eventId: 1, matId: 2, matNumber: 2, eventName: 'Fall Duels', token: 'mat-tok' })
    mount('/mat')
    expect(await screen.findByText(/bound to Mat 2/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Unbind this device' }))
    expect(getMatBinding()).toBeNull()
  })

  it('shows the picker with a notice when the stored binding is for a different event', async () => {
    fakeFetch(url => {
      if (url === '/api/events/5/board') {
        return { json: sampleSnapshot({
          event: { id: 5, name: 'Winter Duels', date: '2026-11-01', status: 'live', matCount: 1 },
          mats: [{ id: 3, number: 1, current: null, onDeck: [], bound: false }],
        }) }
      }
      return { json: {} }
    })
    setMatBinding({ eventId: 1, matId: 2, matNumber: 2, eventName: 'Fall Duels', token: 'mat-tok' })
    mount('/mat?event=5')
    expect(await screen.findByRole('button', { name: 'Bind mat 1' })).toBeInTheDocument()
    expect(screen.getByText(/bound to Fall Duels, mat 2/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Unbind this device' }))
    expect(getMatBinding()).toBeNull()
  })

  it('shows a message when the event has no mats', async () => {
    fakeFetch(url => {
      if (url === '/api/events/9/board') {
        return { json: sampleSnapshot({
          event: { id: 9, name: 'Empty Duels', date: '2026-12-01', status: 'setup', matCount: 0 },
          mats: [],
        }) }
      }
      return { json: {} }
    })
    mount('/mat?event=9')
    expect(await screen.findByText('This event has no mats yet')).toBeInTheDocument()
  })

  it('surfaces a 429 rate limit error', async () => {
    fakeFetch(url => {
      if (url === '/api/events/1/board') return { json: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }, { id: 2, number: 2, current: null, onDeck: [], bound: false }] }) }
      if (url === '/api/events/1/mats/2/bind') return { status: 429, json: { error: { code: 'rate_limited', message: 'too many attempts; wait a minute' } } }
      return { json: {} }
    })
    mount('/mat?event=1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Bind mat 2' }))
    await user.type(screen.getByLabelText('Mat code'), '0420')
    await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('too many attempts; wait a minute')
  })
})
