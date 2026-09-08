import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import MatPickPage from '@/routes/MatPickPage'
import { getMatBinding, setMatBinding } from '@/lib/auth'
import { unlockAudio } from '@/lib/sounds'
import { DESK_BIND_REFUSAL } from '@/lib/eventMode'
import { BIND_LOSS_COPY } from '@/lib/matBinding'
import { POLL_DATA_ENTRY_MS } from '@/lib/pollInterval'
import type { EventMode } from '@shared/types'
import { fakeFetch, sampleSnapshot, type Reply } from './fakes'

vi.mock('@/lib/sounds', () => ({ unlockAudio: vi.fn() }))

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  // unlockAudio is a vi.mock() at module scope, so its call count survives across
  // tests unless cleared -- every other test's first code-field tap would otherwise
  // leak into this file's own call-count assertions.
  vi.clearAllMocks()
})

// The established shape for a polled screen under fake timers: advance the clock and let
// every promise the tick started settle inside the same act().
async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

// The route in `routes` is lazy, and a dynamic import needs a turn of the real event loop
// that a faked clock never gives it, so a test that drives this screen on fake timers
// mounts the page itself. Everything else about the mount is the same.
function mountEager(path: string) {
  render(<RouterProvider router={createMemoryRouter([{ path: '/mat', element: <MatPickPage /> }], { initialEntries: [path] })} />)
}

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

  it('offers to open or unbind an existing binding, and tells the server about the unbind', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    setMatBinding({ eventId: 1, matId: 2, matNumber: 2, eventName: 'Fall Duels', token: 'mat-tok' })
    mount('/mat')
    expect(await screen.findByText(/bound to Mat 2/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Unbind this device' }))
    expect(getMatBinding()).toBeNull()
    // M11: the mat reads free at once, so a re-bind from this same iPad needs no takeover
    // and the Live tab stops saying a scorer is on it a minute early.
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/mats/2/unbind' && c.init?.method === 'POST')).toBe(true))
  })

  it('shows the picker with a notice when the stored binding is for a different event', async () => {
    fakeFetch(url => {
      if (url === '/api/events/5/snapshot') {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 5, name: 'Winter Duels', date: '2026-11-01', status: 'live', mode: 'live', matCount: 1, contact: null, certifiedAt: null },
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
          event: { id: 9, name: 'Empty Duels', date: '2026-12-01', status: 'setup', mode: 'live', matCount: 0, contact: null, certifiedAt: null },
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
          event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'live', mode: 'live', matCount: 6, contact: null, certifiedAt: null },
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

  /**
   * G10. An entry mode event has no mat for this iPad to score, so the picker is not a
   * control that happens to be disabled, it is a control that does not apply. The screen
   * rendered the heading, four 104px mat toggles and the code field and only then a
   * refusal above a dead Bind button, so a volunteer worked through all of it before
   * reading the sentence that says none of it does anything.
   */
  it('replaces the whole picker with the refusal on an event that runs from the desk', async () => {
    const f = fakeFetch(url => {
      if (url === '/api/events/3/snapshot') {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 3, name: 'Fall Duels', date: '2026-10-03', status: 'live', mode: 'entry', matCount: 1, contact: null, certifiedAt: null },
          mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
        }) } }
      }
      return { json: {} }
    })
    mount('/mat?event=3')
    expect(await screen.findByText(DESK_BIND_REFUSAL)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mat 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bind this iPad' })).toBeNull()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByText('Pick your mat')).toBeNull()

    // Watching is the one thing this tablet can still do, so the board URL stays.
    expect(screen.getByText(`${window.location.origin}/board/3`)).toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(f.calls.some(c => c.url.includes('/bind'))).toBe(false)
    expect(getMatBinding()).toBeNull()
  })

  /**
   * The refusal is computed from the event, so it has to track the event. Read once when
   * the page opened, it did not: a tablet left on this screen since 09:40 kept refusing
   * under a reason the organizer cleared at 10:00, and the only cure was a reload nobody
   * knows to do.
   */
  it('re-reads the event, so a refusal cannot outlive the reason for it', async () => {
    vi.useFakeTimers()
    let mode: EventMode = 'entry'
    const f = fakeFetch(url => {
      if (url === '/api/events/3/snapshot') {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 3, name: 'Fall Duels', date: '2026-10-03', status: 'live', mode, matCount: 1, contact: null, certifiedAt: null },
          mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
        }) } }
      }
      return { json: { token: 'mat-tok', mat: { id: 1, number: 1 }, event: { id: 3, name: 'Fall Duels' } } }
    })
    mountEager('/mat?event=3')
    await flush()
    expect(screen.getByText(DESK_BIND_REFUSAL)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bind this iPad' })).toBeNull()

    // At 10:00 the organizer switches the event back to the mats. Nobody touches the iPad.
    mode = 'live'
    await flush(POLL_DATA_ENTRY_MS)
    expect(screen.queryByText(DESK_BIND_REFUSAL)).not.toBeInTheDocument()

    // And the handler lets go with it, not just the sentence.
    fireEvent.click(screen.getByRole('button', { name: 'Mat 1' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Bind this iPad' }).closest('form') as HTMLFormElement)
    await flush()
    expect(f.calls.some(c => c.url.includes('/bind'))).toBe(true)
  })

  /**
   * G08. Two tablets could bind the same mat with nothing said on either of them, and the
   * second one silently killed the first: the mat went on showing a live match on a device
   * whose every write now failed. The snapshot says which mats already have an iPad, and
   * taking one off another device is a decision with its own control and its own words.
   */
  describe('a mat that already has an iPad', () => {
    const twoMats = (boundIds: number[]) => sampleSnapshot({
      mats: [1, 2].map(n => ({ id: n, number: n, current: null, onDeck: [], bound: boundIds.includes(n) })),
    })

    const serve = (over: (url: string, init?: RequestInit) => Reply | undefined) => fakeFetch((url, init) => {
      if (url === '/api/events/1/snapshot') return { json: { version: 1, snapshot: twoMats([2]) } }
      return over(url, init) ?? { json: {} }
    })

    it('marks it with the word and a rule, and leaves an unbound mat alone', async () => {
      serve(() => undefined)
      mount('/mat?event=1')
      const taken = await screen.findByRole('button', { name: 'Mat 2 Scoring' })
      expect(taken).toBeInTheDocument()
      // Section 8: a rule and a word, never a fill, and never on the normal state.
      expect(taken.querySelector('.bg-attend')).not.toBeNull()
      const free = screen.getByRole('button', { name: 'Mat 1' })
      expect(free.querySelector('.bg-attend')).toBeNull()
      expect(free.textContent).not.toMatch(/Scoring/)
    })

    it('refuses the bind in the server words, then takes the mat over on a control of its own', async () => {
      const bodies: unknown[] = []
      const f = serve((url, init) => {
        if (url !== '/api/events/1/mats/2/bind') return undefined
        const body = JSON.parse(String(init?.body)) as { takeOver?: boolean }
        bodies.push(body)
        if (!body.takeOver) {
          return { status: 409, json: { error: { code: 'mat_bound', message: 'This mat already has an iPad scoring it. Take it over to score from here instead.' } } }
        }
        return { json: { token: 'mat-tok', mat: { id: 2, number: 2 }, event: { id: 1, name: 'Fall Duels' } } }
      })
      const router = mount('/mat?event=1')
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Mat 2 Scoring' }))
      await typeMatCode(user, '0420')

      expect(screen.queryByRole('button', { name: 'Take over this mat' })).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('This mat already has an iPad scoring it.')
      expect(getMatBinding()).toBeNull()

      // A plain second press of Bind is not an answer to that refusal.
      await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
      await vi.waitFor(() => expect(bodies).toHaveLength(2))
      expect(bodies.every(b => (b as { takeOver?: boolean }).takeOver === undefined)).toBe(true)
      expect(getMatBinding()).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Take over this mat' }))
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/mat/2'))
      expect(bodies[2]).toEqual({ code: '0420', takeOver: true })
      expect(getMatBinding()?.matId).toBe(2)
      expect(f.calls.filter(c => c.url === '/api/events/1/mats/2/bind')).toHaveLength(3)
    })

    // The offer belongs to the mat the server refused, and to no other.
    it('withdraws the takeover offer when the volunteer picks a different mat', async () => {
      serve(url => (url.includes('/bind')
        ? { status: 409, json: { error: { code: 'mat_bound', message: 'This mat already has an iPad scoring it. Take it over to score from here instead.' } } }
        : undefined))
      mount('/mat?event=1')
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Mat 2 Scoring' }))
      await typeMatCode(user, '0420')
      await user.click(screen.getByRole('button', { name: 'Bind this iPad' }))
      expect(await screen.findByRole('button', { name: 'Take over this mat' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Mat 1' }))
      expect(screen.queryByRole('button', { name: 'Take over this mat' })).toBeNull()
    })
  })

  /**
   * G04. The tablet did not come back to this screen on its own: either its token expired
   * between the rehearsal and the event, or another iPad took its mat. Whoever is holding
   * it needs to know why it stopped scoring before they are asked to bind it again.
   */
  describe('a tablet sent back here after losing its mat', () => {
    const serveOneMat = () => fakeFetch(url => (url === '/api/events/1/snapshot'
      ? { json: { version: 1, snapshot: sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }] }) } }
      : { json: {} }))

    it('says the code is needed again after an expired token', async () => {
      serveOneMat()
      mount('/mat?event=1&reason=expired')
      expect(await screen.findByText(BIND_LOSS_COPY.expired)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mat 1' })).toBeInTheDocument()
    })

    it('repeats the server sentence after a takeover', async () => {
      serveOneMat()
      mount('/mat?event=1&reason=taken')
      expect(await screen.findByText(BIND_LOSS_COPY.taken)).toBeInTheDocument()
    })

    it('says nothing when the volunteer simply opened the page', async () => {
      serveOneMat()
      mount('/mat?event=1')
      expect(await screen.findByRole('button', { name: 'Mat 1' })).toBeInTheDocument()
      expect(screen.queryByText(BIND_LOSS_COPY.expired)).toBeNull()
      expect(screen.queryByText(BIND_LOSS_COPY.taken)).toBeNull()
    })
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
