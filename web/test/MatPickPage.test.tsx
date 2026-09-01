import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { getMatBinding, setMatBinding } from '@/lib/auth'
import { unlockAudio } from '@/lib/sounds'
import { fakeFetch, sampleSnapshot } from './fakes'

vi.mock('@/lib/sounds', () => ({ unlockAudio: vi.fn() }))

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  // unlockAudio is a vi.mock() at module scope, so its call count survives across
  // tests unless cleared -- every other test's first code-field tap would otherwise
  // leak into this file's own call-count assertions.
  vi.clearAllMocks()
})

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

// The mat code is 4 independent character wells (CodeField), not one input long enough
// to fake a length, so it's addressed by index, the same way PinGate.test.tsx addresses
// the 6-well PIN.
async function typeMatCode(user: ReturnType<typeof userEvent.setup>, digits: string) {
  const wells = screen.getAllByRole('textbox')
  for (let i = 0; i < digits.length; i++) {
    await user.clear(wells[i])
    await user.type(wells[i], digits[i])
  }
}

// A stand-in for window.matchMedia's MediaQueryList: `set` flips `matches` and notifies
// every listener the guard's effect registered, which is what a real rotation does.
function fakeMediaQueryList(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const mql = {
    get matches() { return matches },
    addEventListener: (_: string, cb: () => void) => { listeners.add(cb) },
    removeEventListener: (_: string, cb: () => void) => { listeners.delete(cb) },
  }
  return { mql, set: (value: boolean) => { matches = value; listeners.forEach(l => l()) } }
}

describe('MatPickPage', () => {
  it('lists mats from the board, binds with the code, stores the binding, and opens the scorer', async () => {
    const f = fakeFetch((url, init) => {
      if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }, { id: 2, number: 2, current: null, onDeck: [], bound: false }] }) } }
      if (url === '/api/events/1/mats/2/bind') return JSON.parse(String(init?.body)).code === '0420'
        ? { json: { token: 'mat-tok', mat: { id: 2, number: 2 }, event: { id: 1, name: 'Fall Duels' } } }
        : { status: 401, json: { error: { code: 'bad_code', message: 'wrong mat code' } } }
      return { json: {} }
    })
    const router = mount('/mat?event=1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Mat 2' }))
    await typeMatCode(user, '9999')
    await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong mat code')
    await typeMatCode(user, '0420')
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
      if (url === '/api/events/5/snapshot') {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 5, name: 'Winter Duels', date: '2026-11-01', status: 'live', matCount: 1 },
          mats: [{ id: 3, number: 1, current: null, onDeck: [], bound: false }],
        }) } }
      }
      return { json: {} }
    })
    setMatBinding({ eventId: 1, matId: 2, matNumber: 2, eventName: 'Fall Duels', token: 'mat-tok' })
    mount('/mat?event=5')
    expect(await screen.findByRole('button', { name: 'Mat 1' })).toBeInTheDocument()
    expect(screen.getByText(/bound to Fall Duels, mat 2/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Unbind this device' }))
    expect(getMatBinding()).toBeNull()
  })

  it('shows a message when the event has no mats', async () => {
    fakeFetch(url => {
      if (url === '/api/events/9/snapshot') {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 9, name: 'Empty Duels', date: '2026-12-01', status: 'setup', matCount: 0 },
          mats: [],
        }) } }
      }
      return { json: {} }
    })
    mount('/mat?event=9')
    expect(await screen.findByText('This event has no mats yet')).toBeInTheDocument()
  })

  it('acquires the screen wake lock and unlocks audio on the first tap into the code field (6.17b, 7.15, 4.1)', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn().mockResolvedValue({ addEventListener: vi.fn(), release })
    vi.stubGlobal('navigator', { wakeLock: { request } })
    fakeFetch(url => {
      if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }] }) } }
      return { json: {} }
    })
    mount('/mat?event=1')
    const user = userEvent.setup()
    expect(request).not.toHaveBeenCalled()
    expect(unlockAudio).not.toHaveBeenCalled()
    const wells = await screen.findAllByRole('textbox')
    await user.click(wells[0])
    expect(request).toHaveBeenCalledTimes(1)
    expect(unlockAudio).toHaveBeenCalledTimes(1)
    await user.click(wells[0])
    expect(request).toHaveBeenCalledTimes(1)
    expect(unlockAudio).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected wake lock honestly instead of failing silently', async () => {
    const request = vi.fn().mockRejectedValue(new Error('not allowed'))
    vi.stubGlobal('navigator', { wakeLock: { request } })
    fakeFetch(url => {
      if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }] }) } }
      return { json: {} }
    })
    mount('/mat?event=1')
    const user = userEvent.setup()
    expect(screen.queryByText('Screen may sleep')).not.toBeInTheDocument()
    const wells = await screen.findAllByRole('textbox')
    await user.click(wells[0])
    expect(await screen.findByText('Screen may sleep')).toBeInTheDocument()
    expect(screen.getByText('Disable auto-lock for this device and keep it plugged in.')).toBeInTheDocument()
  })

  it('surfaces a 429 rate limit error', async () => {
    fakeFetch(url => {
      if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }, { id: 2, number: 2, current: null, onDeck: [], bound: false }] }) } }
      if (url === '/api/events/1/mats/2/bind') return { status: 429, json: { error: { code: 'rate_limited', message: 'too many attempts; wait a minute' } } }
      return { json: {} }
    })
    mount('/mat?event=1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Mat 2' }))
    await typeMatCode(user, '0420')
    await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('too many attempts; wait a minute')
  })

  it('holds mat 2 at the same grid position whether the event runs 2 mats or 4 (6.17b: fixed grid, unused slots empty)', async () => {
    fakeFetch(url => {
      if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 10, number: 2, current: null, onDeck: [], bound: false }, { id: 11, number: 4, current: null, onDeck: [], bound: false }] }) } }
      return { json: {} }
    })
    mount('/mat?event=1')
    const grid = (await screen.findByRole('button', { name: 'Mat 2' })).closest('[role="group"]')
    expect(grid).not.toBeNull()
    const cells = Array.from(grid!.children)
    expect(cells).toHaveLength(4)
    expect(cells[0]).toHaveAttribute('aria-hidden')
    expect(cells[1]).toHaveTextContent('Mat 2')
    expect(cells[2]).toHaveAttribute('aria-hidden')
    expect(cells[3]).toHaveTextContent('Mat 4')
  })

  it('grows the grid past the 4-slot floor so every mat is reachable on a 6-mat event (events.ts allows matCount up to 8)', async () => {
    fakeFetch(url => {
      if (url === '/api/events/1/snapshot') {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'live', matCount: 6 },
          mats: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, number: i + 1, current: null, onDeck: [], bound: false })),
        }) } }
      }
      if (url === '/api/events/1/mats/6/bind') return { json: { token: 'mat-tok', mat: { id: 6, number: 6 }, event: { id: 1, name: 'Fall Duels' } } }
      return { json: {} }
    })
    mount('/mat?event=1')
    const user = userEvent.setup()
    for (let n = 1; n <= 6; n++) {
      expect(await screen.findByRole('button', { name: `Mat ${n}` })).toBeInTheDocument()
    }
    const bindButton = screen.getByRole('button', { name: 'Bind this iPad' })
    expect(bindButton).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Mat 6' }))
    await typeMatCode(user, '0420')
    expect(bindButton).not.toBeDisabled()
    await user.click(bindButton)
    await vi.waitFor(() => expect(getMatBinding()?.matNumber).toBe(6))
  })

  describe('the below-900px / portrait guard (6.17b)', () => {
    it('refuses to bind and shows the board URL instead of a broken screen', async () => {
      const { mql } = fakeMediaQueryList(false)
      vi.stubGlobal('matchMedia', () => mql)
      fakeFetch(() => ({ json: {} }))
      mount('/mat?event=7')
      expect(await screen.findByText('Use a tablet for scoring')).toBeInTheDocument()
      expect(screen.getByText(`${window.location.origin}/board/7`)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Bind this iPad' })).not.toBeInTheDocument()
      expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    })

    it('unblocks live on a rotation, without a reload, once the query matches', async () => {
      const { mql, set } = fakeMediaQueryList(false)
      vi.stubGlobal('matchMedia', () => mql)
      fakeFetch(url => {
        if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }] }) } }
        return { json: {} }
      })
      mount('/mat?event=1')
      expect(await screen.findByText('Use a tablet for scoring')).toBeInTheDocument()
      act(() => set(true))
      expect(await screen.findByRole('button', { name: 'Mat 1' })).toBeInTheDocument()
      expect(screen.queryByText('Use a tablet for scoring')).not.toBeInTheDocument()
    })
  })
})
