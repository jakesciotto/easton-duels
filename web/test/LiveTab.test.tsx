import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { MatchView, Snapshot } from '@shared/types'
import { LiveTab } from '@/routes/event/LiveTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch, snapshotFeed, type Reply, sampleMatch, sampleSnapshot } from './fakes'

vi.mock('qrcode', () => ({ default: { toString: async () => '<svg>mock</svg>' } }))
beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const SERVER_NOW = '2026-10-03T16:00:00.000Z'

const detail: EventDetail = {
  event: { id: 1, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 1, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 1, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [{ id: 1, eventId: 1, number: 1, currentMatchId: 10 }], matches: [], candidateCount: 0,
}

const running = { elapsedMs: 0, startedAt: SERVER_NOW, lengthMs: 300_000 }
const expiredClock = { elapsedMs: 300_000, startedAt: null, lengthMs: 300_000 }

const scored = (over: Partial<MatchView> = {}) => sampleMatch({
  id: 10, orderIndex: 1, clock: running,
  a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: 'grey', weightLbs: 62, score: 6 },
  b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: 'grey-white', weightLbs: 60, score: 2 },
  ...over,
})

const settled = sampleMatch({
  id: 9, orderIndex: 0, status: 'done', endedAt: '2026-10-03T15:41:00.000Z',
  result: { winnerAthleteId: 100, winType: 'submission' },
  a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: 'grey', weightLbs: 62, score: 4 },
  b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: 'grey-white', weightLbs: 60, score: 1 },
})

const onDeckMatch = (id: number, aName: string, bName: string) => sampleMatch({
  id, orderIndex: id, status: 'pending',
  a: { athleteId: id * 10, name: aName, teamId: 1, belt: null, weightLbs: null, score: 0 },
  b: { athleteId: id * 10 + 1, name: bName, teamId: 2, belt: null, weightLbs: null, score: 0 },
})

function oneMat(over: { current?: MatchView | null; onDeck?: MatchView[]; bound?: boolean } = {}, matches?: MatchView[]): Snapshot {
  const current = over.current === undefined ? scored() : over.current
  const onDeck = over.onDeck ?? []
  return sampleSnapshot({
    now: SERVER_NOW,
    mats: [{ id: 1, number: 1, current, onDeck, bound: over.bound ?? false }],
    matches: matches ?? [settled, ...(current ? [current] : []), ...onDeck],
  })
}

// The Live tab isn't behind a lazy route boundary, and its first snapshot poll fires
// immediately on mount, so a fetch handler that seeds the feed before render delivers the
// snapshot without any separate emit step.
function mount(handler: (url: string, init?: RequestInit) => Reply | Promise<Reply>, d: EventDetail = detail) {
  const f = fakeFetch(handler)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><LiveTab detail={d} /></MemoryRouter></QueryClientProvider>)
  return f
}

const connectOnly = (url: string) => (url.endsWith('/connect') ? { json: { url: 'http://192.168.1.20:8422', matCode: '0420' } } : { json: {} })

const panel = (n: number) => screen.findByRole('region', { name: `Mat ${n}` })
const openMenu = async (user: ReturnType<typeof userEvent.setup>, n: number) => {
  await user.click(await screen.findByRole('button', { name: `Mat ${n} actions` }))
}

describe('LiveTab', () => {
  it('shows the connect card and one panel per mat, in mat order', async () => {
    const feed = snapshotFeed(sampleSnapshot({
      now: SERVER_NOW,
      mats: [
        { id: 2, number: 2, current: null, onDeck: [], bound: false },
        { id: 1, number: 1, current: scored(), onDeck: [], bound: true },
      ],
      matches: [scored()],
    }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await screen.findByText('0420')).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.20:8422')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'QR code' })).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'))
    const one = await panel(1)
    expect(within(one).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['Mat 1', 'Mat 2'])
  })

  it('keeps a mat in its place when it goes quiet', async () => {
    const feed = snapshotFeed(sampleSnapshot({
      now: SERVER_NOW,
      mats: [
        { id: 1, number: 1, current: scored(), onDeck: [], bound: true },
        { id: 2, number: 2, current: null, onDeck: [], bound: true },
      ],
      matches: [scored()],
    }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await screen.findByText('Mateo Rivera')).toBeInTheDocument()
    feed.push(sampleSnapshot({
      now: SERVER_NOW,
      mats: [
        { id: 1, number: 1, current: null, onDeck: [], bound: true },
        { id: 2, number: 2, current: scored(), onDeck: [], bound: true },
      ],
      matches: [scored()],
    }))
    await vi.waitFor(() => expect(within(screen.getByRole('region', { name: 'Mat 2' })).getByText('Mateo Rivera')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['Mat 1', 'Mat 2'])
    expect(within(screen.getByRole('region', { name: 'Mat 1' })).getByText('No match bound')).toBeInTheDocument()
  })

  it('holds all three lanes and says what each empty one is missing', async () => {
    const feed = snapshotFeed(oneMat({ current: null, bound: true }, [settled]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('Now')).toBeInTheDocument()
    expect(within(one).getByText('Next')).toBeInTheDocument()
    expect(within(one).getByText('Last result')).toBeInTheDocument()
    expect(within(one).getByText('No match bound')).toBeInTheDocument()
    expect(within(one).getByText('Mat 1 complete')).toBeInTheDocument()
    expect(within(one).getByRole('button', { name: 'Nothing left to record' })).toBeDisabled()
    expect(within(one).getByText('Mateo Rivera beat Olivia Kim by submission')).toBeInTheDocument()
    expect(within(one).getByText('4-1')).toBeInTheDocument()
  })

  it('carries the queue under the next pair', async () => {
    const deck = [
      onDeckMatch(11, 'Ava Park', 'Noah Tran'),
      onDeckMatch(12, 'Emma Cole', 'Ben Ortiz'),
      onDeckMatch(13, 'Sofia Diaz', 'Jayden Ruiz'),
      onDeckMatch(14, 'Maya Lopez', 'Liam Shaw'),
      onDeckMatch(15, 'Ivy Nolan', 'Kai Brooks'),
    ]
    const feed = snapshotFeed(oneMat({ onDeck: deck, bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('Ava Park')).toBeInTheDocument()
    expect(within(one).getByText('Noah Tran')).toBeInTheDocument()
    expect(within(one).getByText('Emma Cole vs Ben Ortiz')).toBeInTheDocument()
    expect(within(one).getByText('Ivy Nolan vs Kai Brooks')).toBeInTheDocument()
  })

  // Finding 1: an unbounded queue pushed the panel's own primary control (the one
  // control the panel exists to hold) below the fold on a deep rack.
  it('caps the queue at four pairs and states the count left off', async () => {
    const deck = [
      onDeckMatch(11, 'Ava Park', 'Noah Tran'),
      onDeckMatch(12, 'Emma Cole', 'Ben Ortiz'),
      onDeckMatch(13, 'Sofia Diaz', 'Jayden Ruiz'),
      onDeckMatch(14, 'Maya Lopez', 'Liam Shaw'),
      onDeckMatch(15, 'Ivy Nolan', 'Kai Brooks'),
      onDeckMatch(16, 'Zoe Chen', 'Leo Park'),
      onDeckMatch(17, 'Mia Cruz', 'Eli Wong'),
    ]
    const feed = snapshotFeed(oneMat({ onDeck: deck, bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    // deck[0] (Ava vs Noah) is the NEXT pair itself; the six behind it are capped at four.
    expect(within(one).getByText('Emma Cole vs Ben Ortiz')).toBeInTheDocument()
    expect(within(one).getByText('Sofia Diaz vs Jayden Ruiz')).toBeInTheDocument()
    expect(within(one).getByText('Maya Lopez vs Liam Shaw')).toBeInTheDocument()
    expect(within(one).getByText('Ivy Nolan vs Kai Brooks')).toBeInTheDocument()
    expect(within(one).queryByText('Zoe Chen vs Leo Park')).not.toBeInTheDocument()
    expect(within(one).queryByText('Mia Cruz vs Eli Wong')).not.toBeInTheDocument()
    expect(within(one).getByText('2 more matches queued')).toBeInTheDocument()
  })

  it('repaints the panel and its control when the clock runs out', async () => {
    const feed = snapshotFeed(oneMat({ current: scored({ clock: expiredClock }), bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(one).toHaveAttribute('data-state', 'attend')
    expect(within(one).getByText('Time expired')).toBeInTheDocument()
    expect(within(one).getByRole('button', { name: 'Time expired. Record result' })).toBeInTheDocument()
  })

  it('marks an unbound mat as needing a person while a running one reads live', async () => {
    const feed = snapshotFeed(sampleSnapshot({
      now: SERVER_NOW,
      mats: [
        { id: 1, number: 1, current: scored(), onDeck: [], bound: true },
        { id: 2, number: 2, current: scored({ id: 20 }), onDeck: [], bound: false },
      ],
      matches: [scored(), scored({ id: 20 })],
    }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await panel(1)).toHaveAttribute('data-state', 'live')
    expect(within(await panel(1)).getByText('Live')).toBeInTheDocument()
    expect(await panel(2)).toHaveAttribute('data-state', 'attend')
    expect(within(await panel(2)).getByText('No scorer')).toBeInTheDocument()
  })

  it('ends a decided match from the panel control', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    await userEvent.setup().click(within(one).getByRole('button', { name: 'End match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end' && c.init?.method === 'POST')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))
    expect(body).toMatchObject({ lastSeq: 0 })
    expect(typeof (body as { id: unknown }).id).toBe('string')
  })

  it('asks who won before ending a level match', async () => {
    const tied = scored({ a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: null, weightLbs: null, score: 3 }, b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: null, weightLbs: null, score: 3 } })
    const feed = snapshotFeed(oneMat({ current: tied, bound: true }))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    const one = await panel(1)
    await user.click(within(one).getByRole('button', { name: 'End match' }))
    const dialog = await screen.findByRole('dialog')
    expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: /Olivia Kim wins/ }))
    await user.click(within(dialog).getByRole('button', { name: 'End match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/end')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/10/end'))).toMatchObject({ lastSeq: 0, winnerAthleteId: 200 })
  })

  it('pauses the rack, counts what is waiting, and commits on resume', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    const one = await panel(1)
    expect(within(one).getByText('6')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause updates' }))
    feed.push(oneMat({ current: scored({ a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: null, weightLbs: null, score: 9 } }), bound: true }))
    const paused = await screen.findByRole('button', { name: 'Paused, 1 update waiting' }, { timeout: 3000 })
    expect(within(await panel(1)).getByText('6')).toBeInTheDocument()
    await user.click(paused)
    expect(within(await panel(1)).getByText('9')).toBeInTheDocument()
  })

  it('collapses the connect card once every mat reports a scorer', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await screen.findByText('0420')).toBeInTheDocument()
    expect(screen.getByText('The mat has a scorer connected.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'QR code' })).not.toBeInTheDocument()
  })

  it('skips the running match from the panel overflow', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    await panel(1)
    await openMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Skip this match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/skip' && c.init?.method === 'POST')).toBe(true))
  })

  it('reopens the last result from the panel overflow', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    await panel(1)
    await openMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Reopen the last match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/9/reopen')).toBe(true))
  })

  it('shows the server message when an override is refused', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount((url, init) => {
      const fromFeed = feed.handle(url)
      if (fromFeed) return fromFeed
      if (url === '/api/matches/10/skip' && init?.method === 'POST') {
        return { status: 409, json: { error: { code: 'match_state', message: 'match is not live' } } }
      }
      return connectOnly(url)
    })
    const user = userEvent.setup()
    await panel(1)
    await openMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Skip this match' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('match is not live')
  })

  // The dialog's own controls are covered by ResultDialog's tests; the panel's job is to
  // hand it the settled match this mat is showing.
  it('opens the result dialog for the mat last result', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    await panel(1)
    await openMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Edit the last result' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Edit result')).toBeInTheDocument()
    expect(within(dialog).getAllByText(/Mateo Rivera/).length).toBeGreaterThan(0)
  })

  it('starts the event', async () => {
    const feed = snapshotFeed(oneMat({ current: null, bound: false }, [settled]))
    const f = mount(url => feed.handle(url) ?? connectOnly(url), { ...detail, event: { ...detail.event, status: 'setup' } })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Start event' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/1' && c.init?.method === 'PATCH')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/1' && c.init?.method === 'PATCH'))).toEqual({ status: 'live' })
  })

  it('finishes the event only after the confirm dialog', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    const patches = () => f.calls.filter(c => c.url === '/api/events/1' && c.init?.method === 'PATCH')
    await user.click(await screen.findByRole('button', { name: 'Finish event' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Finish the event?')).toBeInTheDocument()
    expect(patches()).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Finish event' }))
    await vi.waitFor(() => expect(patches()).toHaveLength(1))
    expect(JSON.parse(String(patches()[0].init?.body))).toEqual({ status: 'done' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the finish dialog open when the server refuses', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount((url, init) => {
      const fromFeed = feed.handle(url)
      if (fromFeed) return fromFeed
      if (url === '/api/events/1' && init?.method === 'PATCH') {
        return { status: 409, json: { error: { code: 'match_state', message: 'only a live event can finish' } } }
      }
      return connectOnly(url)
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Finish event' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Finish event' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('only a live event can finish')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('replaces the rack with the record once the event is finished', async () => {
    const feed = snapshotFeed(sampleSnapshot({
      now: SERVER_NOW,
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', matCount: 1 },
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 42 },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 31 },
      ],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
      matches: [settled],
    }))
    mount(url => feed.handle(url) ?? connectOnly(url), { ...detail, event: { ...detail.event, status: 'done' } })
    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open board' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Mat 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End match' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause updates' })).not.toBeInTheDocument()
  })

  // Finding 2: the head and each row were separate `auto`-track grid containers, so
  // each sized its own columns from its own content -- the head's small labels versus
  // a row's t7 Wins figure and t5 Points/Matches figures, three different `ch`
  // contexts under one declared track. The literal-px fix must show up on both.
  it('lands the final result head and rows on the same fixed track', async () => {
    const feed = snapshotFeed(sampleSnapshot({
      now: SERVER_NOW,
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', matCount: 1 },
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 42 },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 31 },
      ],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
      matches: [settled],
    }))
    mount(url => feed.handle(url) ?? connectOnly(url), { ...detail, event: { ...detail.event, status: 'done' } })
    const winsHead = (await screen.findByText('Wins')).parentElement as HTMLElement
    const winsRow = screen.getByText('7').parentElement as HTMLElement
    expect(winsHead.className).toMatch(/62\.4px/)
    expect(winsRow.className).toMatch(/62\.4px/)
    expect(winsHead.className).not.toMatch(/auto/)
    expect(winsRow.className).not.toMatch(/auto/)
  })
})
