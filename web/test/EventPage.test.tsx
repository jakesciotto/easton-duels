import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Snapshot } from '@shared/types'
import EventPage from '@/routes/EventPage'
import { qk } from '@/lib/queries'
import { ENGAGEMENT_RECHECK_MS } from '@/lib/operatorEngaged'
import { DESK_NOTE, MODE_GROUP_LABEL, MODE_LABEL, MODE_ORDER } from '@/lib/eventMode'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch, sampleMatch, sampleSnapshot, type Reply } from './fakes'

vi.mock('qrcode', () => ({ default: { toString: async () => '<svg>mock</svg>' } }))
beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
})

const match = (id: number, orderIndex: number, a: number, b: number): MatchRow => ({
  id, eventId: 7, matId: 1, orderIndex, rulesetId: 1, lengthSec: 300, athleteAId: a, athleteBId: b, status: 'pending',
  winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
})

const ROSTER = [
  kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(102, 1, 'Liam', 'Cruz'),
  kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran'), kid(202, 2, 'Kai', 'Wong'),
]

const IN_ORDER = [match(1, 0, 100, 200), match(2, 1, 101, 201), match(3, 2, 102, 202)]
// The same three matches after another desk moved the last one to the front.
const REORDERED = [match(1, 1, 100, 200), match(2, 2, 101, 201), match(3, 0, 102, 202)]

function detailWith(matches: MatchRow[], athletes = ROSTER): EventDetail {
  return {
    event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', mode: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
    teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
    athletes,
    rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
    mats: [{ id: 1, eventId: 7, number: 1, currentMatchId: null }],
    matches,
    candidateCount: 0,
  }
}

// An event with no mats bound polls at the data-entry rate (7.15), which is five seconds.
// Nothing in these tests takes that long, so any extra snapshot request inside one is a
// second poll loop rather than the shared one ticking.
//
// The stream is where every screen reads the mode from now, so a fixture whose snapshot
// disagreed with its detail would be describing a stale cache rather than an event.
const slowSnapshot = (over: Partial<Snapshot['event']> = {}) => sampleSnapshot({
  mats: [],
  matches: [],
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', status: 'setup', mode: 'live', matCount: 1, ...over },
})
const SLOW_SNAPSHOT = slowSnapshot()

function mount(handler: (url: string, init?: RequestInit) => Reply | undefined) {
  const f = fakeFetch((url, init) => handler(url, init) ?? { json: [] })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/events/:eventId', element: <EventPage /> }], { initialEntries: ['/events/7'] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return { f, qc }
}

const snapshotReply = (url: string, snapshot: Snapshot = SLOW_SNAPSHOT): Reply | undefined =>
  /\/snapshot(\?|$)/.test(url) ? { json: { version: 1, snapshot } } : undefined

const pendingRows = () => within(screen.getByRole('region', { name: 'Pending matches' })).getAllByRole('row').slice(1)

// The row's own account of who is in it: every competitor line is a button named
// "<name>, <team>", and team A's is the one the running order is read by.
const runningOrder = () => pendingRows().map(row =>
  within(row).getAllByRole('button')
    .map(b => b.getAttribute('aria-label') ?? '')
    .find(label => label.endsWith(', Ridgeline')))

const snapshotGets = (f: { calls: { url: string }[] }) => f.calls.filter(c => c.url.includes('/snapshot')).length

/**
 * Waits until the refetched detail is in the cache AND a render pass has had every chance
 * to put it on screen: react-query notifies through a scheduler, so reading the DOM the
 * instant invalidateQueries() resolves would pass whether or not anything is held. Two
 * full recheck intervals is several times what an unheld commit takes.
 */
async function settled(qc: QueryClient, ready: (d: EventDetail) => boolean) {
  await vi.waitFor(() => {
    const cached = qc.getQueryData<EventDetail>(qk.event(7))
    expect(cached !== undefined && ready(cached)).toBe(true)
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ENGAGEMENT_RECHECK_MS * 2)) })
}

describe('EventPage, 4.4: the event detail is held while the operator is engaged', () => {
  it('does not re-index the running order under a drag, and applies the refetch on the drop', async () => {
    let matches = IN_ORDER
    const { qc } = mount(url => snapshotReply(url) ?? (url === '/api/events/7' ? { json: detailWith(matches) } : undefined))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: /Matches/ }))
    expect(runningOrder()).toEqual(['Mateo Rivera, Ridgeline', 'Ava Park, Ridgeline', 'Liam Cruz, Ridgeline'])

    // The operator presses on row 1 and starts dragging it. jsdom has no PointerEvent, so
    // the polyfill is a MouseEvent and drops isPrimary, which the sensor checks first.
    const grip = within(pendingRows()[0]).getAllByRole('button', { name: /reorder/i })[0]
    const down = createEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 })
    Object.defineProperty(down, 'isPrimary', { value: true })
    fireEvent(grip, down)
    fireEvent.pointerMove(document, { clientX: 0, clientY: 40 })
    expect(document.querySelector('[data-dragging="true"]')).not.toBeNull()

    // Mid gesture, an earlier reorder resolves and react-query refetches the detail.
    matches = REORDERED
    await act(async () => { await qc.invalidateQueries({ queryKey: qk.event(7) }) })
    await settled(qc, d => d.matches.some(m => m.id === 3 && m.orderIndex === 0))

    // The list the gesture is indexing against has not moved.
    expect(runningOrder()).toEqual(['Mateo Rivera, Ridgeline', 'Ava Park, Ridgeline', 'Liam Cruz, Ridgeline'])

    fireEvent.pointerUp(document, { clientX: 0, clientY: 40 })
    await vi.waitFor(() => expect(runningOrder()).toEqual(['Liam Cruz, Ridgeline', 'Mateo Rivera, Ridgeline', 'Ava Park, Ridgeline']))
    // The sensor removes its capture-phase click swallower 50ms after the drop, and the
    // document outlives a test.
    await new Promise(resolve => setTimeout(resolve, 60))
  })

  it('does not swap the roster out from under a cell that is being edited', async () => {
    let athletes = ROSTER
    const { qc } = mount(url => snapshotReply(url) ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER, athletes) } : undefined))
    const user = userEvent.setup()

    const rosterTab = await screen.findByRole('tab', { name: /Roster/ })
    expect(rosterTab).toHaveTextContent('Roster6')

    // The cell opens an autofocused field: the operator is typing into the roster.
    await user.click(screen.getAllByRole('button', { name: 'Age for Mateo Rivera, 8' })[0])
    expect(screen.getByLabelText('Age for Mateo Rivera')).toHaveFocus()

    athletes = [...ROSTER, kid(103, 1, 'Ivy', 'Sandoval')]
    await act(async () => { await qc.invalidateQueries({ queryKey: qk.event(7) }) })
    await settled(qc, d => d.athletes.length === 7)

    expect(rosterTab).toHaveTextContent('Roster6')
    expect(screen.getByLabelText('Age for Mateo Rivera')).toHaveFocus()

    // Escape reverts the edit and writes nothing, which is the operator letting go.
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(rosterTab).toHaveTextContent('Roster7'))
  })
})

describe('EventPage, 6.4: one poll for the whole event', () => {
  it('serves every tab from the stream the event body owns rather than one loop per tab', async () => {
    const { f } = mount(url => snapshotReply(url) ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER) } : undefined))
    const user = userEvent.setup()

    await screen.findByRole('tab', { name: /Roster/ })
    await vi.waitFor(() => expect(snapshotGets(f)).toBe(1))

    // Both of these tabs read the snapshot. A tab that mounts its own useSnapshot polls
    // immediately, so a second request here is a second loop.
    await user.click(screen.getByRole('tab', { name: 'Live' }))
    expect(await screen.findByText('This event has no mats.')).toBeInTheDocument()
    expect(snapshotGets(f)).toBe(1)

    await user.click(screen.getByRole('tab', { name: /Matches/ }))
    await screen.findByRole('region', { name: 'Pending matches' })
    expect(snapshotGets(f)).toBe(1)
  })

  // The pause has to live on the shared stream, not inside the tab. A pause the header
  // cannot see leaves the shell reporting live data over a screen the operator has
  // deliberately stopped, which is the one reading a stale board must never give.
  it('reports the paused rack in the header, not a fresh age', async () => {
    mount(url => snapshotReply(url) ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER) } : undefined))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Live/ }))

    const pause = await screen.findByRole('button', { name: 'Pause updates' })
    expect(screen.getByRole('banner')).not.toHaveTextContent('Paused')

    await user.click(pause)
    expect(screen.getByRole('banner')).toHaveTextContent(/Paused/)
    await user.click(screen.getByRole('button', { name: /Paused/ }))
    expect(screen.getByRole('banner')).not.toHaveTextContent('Paused')
  })
})

/**
 * The mode is an EVENT SETTING, not a screen setting. The app used to infer it from
 * whether a mat happened to be bound at that instant, which let the board flip
 * composition on a reload between bouts.
 */
describe('EventPage: how the event runs is one stored setting on the shell', () => {
  const withEvent = (over: Partial<EventDetail['event']>) => {
    const d = detailWith(IN_ORDER)
    return { ...d, event: { ...d.event, ...over } }
  }
  // The two sources agree, which is what a healthy event looks like: the detail is the
  // row this browser loaded and the snapshot is the same row a second later.
  const detailRoute = (over: Partial<EventDetail['event']> = {}, snapshot?: Snapshot) => (url: string) =>
    snapshotReply(url, snapshot ?? slowSnapshot({ mode: over.mode ?? 'live', status: over.status ?? 'setup' }))
      ?? (url === '/api/events/7' ? { json: withEvent(over) } : undefined)
  const patchIndex = (f: { calls: { url: string; init?: RequestInit }[] }) =>
    f.calls.findIndex(c => c.url === '/api/events/7' && c.init?.method === 'PATCH')
  const deskOption = () => screen.getByRole('radio', { name: MODE_LABEL.entry })
  const matsOption = () => screen.getByRole('radio', { name: MODE_LABEL.live })

  it('lands on the Roster tab in live mode', async () => {
    mount(detailRoute())
    expect(await screen.findByRole('tab', { name: /Roster/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Entry' })).toHaveAttribute('aria-selected', 'false')
  })

  // In entry mode the Entry tab IS the product, so a freshly opened event opens on it
  // rather than making the desk click across on every reload.
  it('lands on the Entry tab when the event runs from the desk', async () => {
    mount(detailRoute({ mode: 'entry' }))
    expect(await screen.findByRole('tab', { name: 'Entry' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Roster/ })).toHaveAttribute('aria-selected', 'false')
  })

  // The same exported option list the New event dialog renders, so the two screens cannot
  // drift into different words or the opposite order again.
  it('names the two ways an event runs in the shared words and order', async () => {
    mount(detailRoute())
    const group = await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    expect(within(group).getAllByRole('radio').map(r => r.getAttribute('aria-label')))
      .toEqual(MODE_ORDER.map(m => MODE_LABEL[m]))
  })

  it('patches the event when the operator picks the other way of running it', async () => {
    const { f } = mount(detailRoute())
    const user = userEvent.setup()
    await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    // Nothing is bound on this event, so the switch is a plain tap: no dialog, no second
    // confirmation, nothing added to the healthy path.
    await vi.waitFor(() => expect(deskOption()).not.toHaveAttribute('aria-disabled'))
    expect(matsOption()).toBeChecked()

    await user.click(deskOption())
    await vi.waitFor(() => expect(patchIndex(f)).toBeGreaterThan(-1))
    expect(f.body(patchIndex(f))).toEqual({ mode: 'entry' })
  })

  // The desk path is the fallback for the day the tablets do not work, so a setting that
  // locks itself at Start event is a fallback nobody can reach.
  it('stays changeable while the event is live', async () => {
    const { f } = mount(detailRoute({ status: 'live', mode: 'entry' }))
    const user = userEvent.setup()
    await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    await vi.waitFor(() => expect(matsOption()).not.toHaveAttribute('aria-disabled'))

    await user.click(matsOption())
    await vi.waitFor(() => expect(patchIndex(f)).toBeGreaterThan(-1))
    expect(f.body(patchIndex(f))).toEqual({ mode: 'live' })
  })

  /**
   * One fact, one source. The organizer switches the event from a phone at the same desk;
   * nothing invalidates this laptop's react-query cache, so a shell reading the detail
   * went on stating the opposite of what the television in the same room had already
   * repainted to.
   */
  it('reads the mode from the polled stream, not from a detail cache nothing invalidated', async () => {
    mount(url => snapshotReply(url, slowSnapshot({ mode: 'entry' }))
      ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER) } : undefined))
    const user = userEvent.setup()

    await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    await vi.waitFor(() => expect(deskOption()).toBeChecked())

    // And the tab under the shell says the same thing, from the same stream.
    await user.click(screen.getByRole('tab', { name: 'Live' }))
    expect(await screen.findByText(DESK_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'QR code' })).not.toBeInTheDocument()
  })

  /**
   * Refuse rather than ask (6.8). Switching to the desk repaints the television as the
   * Final Score panel within one poll, so a mat with a scorer on it would go on being
   * scored by a room that can no longer see it.
   */
  it('refuses the switch to the desk while a mat is bound, and prints which mat', async () => {
    const bound = slowSnapshot()
    const { f } = mount(url => snapshotReply(url, {
      ...bound,
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }],
    }) ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER) } : undefined))

    await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    // A segment cell is a span with role=radio, so "disabled" here is the ARIA state the
    // primitive sets, and base-ui refuses the selection itself on top of the guard below.
    await vi.waitFor(() => expect(deskOption()).toHaveAttribute('aria-disabled', 'true'))
    // The reason is printed as text, not left to a tooltip or a silent no-op.
    expect(screen.getByText(/^Mat 1 has an iPad connected\./)).toBeInTheDocument()

    // A disabled control still leaves a programmatic change able to fire, so the refusal
    // has to hold at the handler too.
    fireEvent.click(deskOption())
    await act(async () => { await Promise.resolve() })
    expect(patchIndex(f)).toBe(-1)
  })

  it('refuses while a mat is carrying a match, and lets go once the rack is clear', async () => {
    const base = slowSnapshot({ status: 'live' })
    // A running clock, which is both the failure story's own mat and the fastest poll
    // rung, so the release below lands on the next tick rather than three seconds later.
    const running = sampleMatch({ id: 10, clock: { elapsedMs: 0, startedAt: base.now, lengthMs: 300_000 } })
    let mats: Snapshot['mats'] = [{ id: 1, number: 1, current: running, onDeck: [], bound: false }]
    mount(url => snapshotReply(url, { ...base, mats }) ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER) } : undefined))

    await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    await vi.waitFor(() => expect(deskOption()).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByText(/^Mat 1 is on a match\./)).toBeInTheDocument()

    mats = [{ id: 1, number: 1, current: null, onDeck: [], bound: false }]
    await vi.waitFor(() => expect(deskOption()).not.toHaveAttribute('aria-disabled'), { timeout: 4000 })
    expect(screen.queryByText(/is on a match\./)).not.toBeInTheDocument()
  })

  // 7.12 / the Alert primitive: a failed write says what failed, in a titled band with a
  // role, not as a bare red fragment wedged in beside the date and the counts.
  it('reports a refused switch in the Alert primitive, with a title naming the action', async () => {
    mount((url, init) => {
      if (url === '/api/events/7' && init?.method === 'PATCH') {
        return { status: 409, json: { error: { code: 'event_state', message: 'this event is finished' } } }
      }
      return snapshotReply(url) ?? (url === '/api/events/7' ? { json: detailWith(IN_ORDER) } : undefined)
    })
    const user = userEvent.setup()
    await screen.findByRole('radiogroup', { name: MODE_GROUP_LABEL })
    await vi.waitFor(() => expect(deskOption()).not.toHaveAttribute('aria-disabled'))
    await user.click(deskOption())

    const alert = await screen.findByRole('alert')
    expect(alert.querySelector('[data-slot="alert-title"]')).toHaveTextContent('How this event runs was not changed')
    expect(alert.querySelector('[data-slot="alert-description"]')).toHaveTextContent('this event is finished')
  })
})
