import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { EventMode, EventStatus, MatchView, Snapshot } from '@shared/types'
import { CORRECTION_REASON_MAX } from '@shared/types'
import { LiveTab } from '@/routes/event/LiveTab'
import { setAdminToken } from '@/lib/auth'
import { CERTIFIED_REFUSAL, DESK_NOTE, DESK_NOTE_DETAIL, DESK_PANEL_WORD, FINISHED_LINE, deskMatNote } from '@/lib/eventMode'
import type { EventDetail } from '@/lib/types'
import { fakeFetch, snapshotFeed, type Reply, sampleMatch, sampleSnapshot } from './fakes'

vi.mock('qrcode', () => ({ default: { toString: async () => '<svg>mock</svg>' } }))
beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const SERVER_NOW = '2026-10-03T16:00:00.000Z'

const detail: EventDetail = {
  event: { id: 1, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'live', mode: 'live', sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 1, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 1, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [{ id: 1, eventId: 1, number: 1, currentMatchId: 10 }], matches: [], candidateCount: 0,
}

// The same event as `detail`, with mat 1 actually holding the live match its
// currentMatchId points at, which is what the shared Finish dialog reads.
const withLiveMat: EventDetail = {
  ...detail,
  athletes: [
    { id: 100, eventId: 1, teamId: 1, firstName: 'Mateo', lastName: 'Rivera', age: 9, ageSource: 'manual', weightLbs: 62, weightSource: 'manual', belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null, promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [] },
    { id: 200, eventId: 1, teamId: 2, firstName: 'Olivia', lastName: 'Kim', age: 9, ageSource: 'manual', weightLbs: 60, weightSource: 'manual', belt: 'grey-white', gender: 'F', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null, promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [] },
  ],
  matches: [{
    id: 10, eventId: 1, matId: 1, orderIndex: 1, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200,
    status: 'live', winnerAthleteId: null, winType: null, pointsA: 6, pointsB: 2, clockElapsedMs: 0,
    clockStartedAt: SERVER_NOW, pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
  }],
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
    expect(within(screen.getByRole('region', { name: 'Mat 1' })).getByText('No match on this mat')).toBeInTheDocument()
  })

  it('holds all three lanes and says what each empty one is missing', async () => {
    const feed = snapshotFeed(oneMat({ current: null, bound: true }, [settled]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('Now')).toBeInTheDocument()
    expect(within(one).getByText('Next')).toBeInTheDocument()
    expect(within(one).getByText('Last result')).toBeInTheDocument()
    expect(within(one).getByText('No match on this mat')).toBeInTheDocument()
    expect(within(one).getByText('Mat 1 complete')).toBeInTheDocument()
    // 7.10 / 6.9: an exhausted mat gets no primary control at all. A disabled button on
    // every panel for the rest of the afternoon is the information-free blank with a
    // border around it, and nothing on it can be pressed.
    expect(within(one).queryByRole('button', { name: 'Nothing left to record' })).not.toBeInTheDocument()
    expect(within(one).queryByRole('button', { name: 'Call the next match' })).not.toBeInTheDocument()
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

  /**
   * Finding 1: an unbounded queue pushed the panel's own primary control (the one control
   * the panel exists to hold) below the fold on a deep rack.
   *
   * G06: the depth line is counted from the whole match list, not from `onDeck`. The
   * serializer caps `onDeck` at ON_DECK_DEPTH (five) and the panel shows one pair plus
   * four lines, so a remainder derived from `onDeck` was always zero and the line was
   * dead code. The fixture below is what the server can actually produce: five on deck
   * and eleven pending on the mat.
   */
  it('caps the queue at four pairs and counts the depth the server would not send', async () => {
    const deck = [
      onDeckMatch(11, 'Ava Park', 'Noah Tran'),
      onDeckMatch(12, 'Emma Cole', 'Ben Ortiz'),
      onDeckMatch(13, 'Sofia Diaz', 'Jayden Ruiz'),
      onDeckMatch(14, 'Maya Lopez', 'Liam Shaw'),
      onDeckMatch(15, 'Ivy Nolan', 'Kai Brooks'),
    ]
    const behind = [
      onDeckMatch(16, 'Zoe Chen', 'Leo Park'),
      onDeckMatch(17, 'Mia Cruz', 'Eli Wong'),
      onDeckMatch(18, 'Ruby Hale', 'Owen Diaz'),
      onDeckMatch(19, 'Nina Vos', 'Theo Marsh'),
      onDeckMatch(20, 'Cleo Banks', 'Jonah Reed'),
      onDeckMatch(21, 'Iris Doyle', 'Milo Frank'),
    ]
    const current = scored()
    const feed = snapshotFeed(oneMat({ onDeck: deck, bound: true }, [settled, current, ...deck, ...behind]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    // deck[0] (Ava vs Noah) is the NEXT pair itself; the four behind it are the queue.
    expect(within(one).getByText('Emma Cole vs Ben Ortiz')).toBeInTheDocument()
    expect(within(one).getByText('Sofia Diaz vs Jayden Ruiz')).toBeInTheDocument()
    expect(within(one).getByText('Maya Lopez vs Liam Shaw')).toBeInTheDocument()
    expect(within(one).getByText('Ivy Nolan vs Kai Brooks')).toBeInTheDocument()
    expect(within(one).queryByText('Zoe Chen vs Leo Park')).not.toBeInTheDocument()
    // Eleven pending on the mat, five of them printed, so six are left off.
    expect(within(one).getByText('and 6 more')).toBeInTheDocument()
  })

  it('prints no depth line when the whole queue is on screen', async () => {
    const deck = [onDeckMatch(11, 'Ava Park', 'Noah Tran'), onDeckMatch(12, 'Emma Cole', 'Ben Ortiz')]
    const current = scored()
    const feed = snapshotFeed(oneMat({ onDeck: deck, bound: true }, [settled, current, ...deck]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('Emma Cole vs Ben Ortiz')).toBeInTheDocument()
    expect(within(one).queryByText(/^and \d+ more$/)).not.toBeInTheDocument()
  })

  /**
   * G02. A mat that goes idle with a queue behind it has nothing to trigger its own
   * advance: the server binds the next match when one ends or is skipped, and a match
   * added to the mat, moved onto it, or a mat created after Start is none of those. The
   * panel used to print "Nothing is bound to mat 1" on a disabled control, which is a
   * report of a state with no way out of it.
   */
  it('calls the next match onto an idle mat that still has a queue', async () => {
    const deck = [onDeckMatch(11, 'Ava Park', 'Noah Tran')]
    const feed = snapshotFeed(oneMat({ current: null, onDeck: deck, bound: true }, [settled, ...deck]))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(one).toHaveAttribute('data-state', 'attend')
    expect(within(one).getByText('No match')).toBeInTheDocument()

    await userEvent.setup().click(within(one).getByRole('button', { name: 'Call the next match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/mats/1/advance' && c.init?.method === 'POST')).toBe(true))
  })

  /**
   * G18. "Bound" meant two things on one panel: a missing tablet printed "No scorer", a
   * missing match printed "Nothing bound", and a mat with neither printed the second and
   * lost the first. Each fact is now its own line and a mat missing both says both.
   */
  it('prints the missing match and the missing scorer as separate facts', async () => {
    const deck = [onDeckMatch(11, 'Ava Park', 'Noah Tran')]
    const feed = snapshotFeed(oneMat({ current: null, onDeck: deck, bound: false }, [settled, ...deck]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('No match on this mat')).toBeInTheDocument()
    expect(within(one).getByText('No scorer')).toBeInTheDocument()
    expect(within(one).queryByText('Nothing bound')).not.toBeInTheDocument()
  })

  it('drops the scorer line once the mat has nothing left to run', async () => {
    const feed = snapshotFeed(oneMat({ current: null, bound: false }, [settled]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('No match on this mat')).toBeInTheDocument()
    expect(within(one).queryByText('No scorer')).not.toBeInTheDocument()
    expect(within(one).getByText('Complete')).toBeInTheDocument()
  })

  it('prints the missing match alone while a scorer is bound', async () => {
    const deck = [onDeckMatch(11, 'Ava Park', 'Noah Tran')]
    const feed = snapshotFeed(oneMat({ current: null, onDeck: deck, bound: true }, [settled, ...deck]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('No match on this mat')).toBeInTheDocument()
    expect(within(one).queryByText('No scorer')).not.toBeInTheDocument()
  })

  it('prints the server reason when the mat is already showing a match', async () => {
    const deck = [onDeckMatch(11, 'Ava Park', 'Noah Tran')]
    const feed = snapshotFeed(oneMat({ current: null, onDeck: deck, bound: true }, [settled, ...deck]))
    mount((url, init) => {
      const fromFeed = feed.handle(url)
      if (fromFeed) return fromFeed
      if (url === '/api/mats/1/advance' && init?.method === 'POST') {
        return { status: 409, json: { error: { code: 'match_state', message: 'this mat is already showing a match' } } }
      }
      return connectOnly(url)
    })
    const one = await panel(1)
    await userEvent.setup().click(within(one).getByRole('button', { name: 'Call the next match' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('this mat is already showing a match')
  })

  /**
   * G20. The primary used to end the match on whatever the dead tablet last sent, and the
   * true score then needed "Edit the last result" afterwards with nothing on the screen
   * saying so. The entry route on a live match pauses the clock and ends it with the typed
   * score in one write, so the panel opens the result dialog and the two steps become one.
   */
  it('routes the primary through the result dialog when the scorer is gone', async () => {
    const feed = snapshotFeed(oneMat({ bound: false }))
    const f = mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).queryByRole('button', { name: 'End match' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(within(one).getByRole('button', { name: 'Enter the result' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Enter the result' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Mateo Rivera wins/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/entry' && c.init?.method === 'POST')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/matches/10/entry'))
    expect(body).toMatchObject({ pointsA: 6, pointsB: 2, winnerAthleteId: 100, winType: 'points' })
  })

  it('keeps End match as the primary while a scorer is bound', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByRole('button', { name: 'End match' })).toBeInTheDocument()
    expect(within(one).queryByRole('button', { name: 'Enter the result' })).not.toBeInTheDocument()
  })

  // A settled result still sitting on an unbound mat is not the dead tablet case: it has
  // its own door in the overflow, and offering to enter a result over it would invite a
  // second write on a match that already has one.
  it('leaves a settled match on an unbound mat to the overflow', async () => {
    const done = scored({ status: 'done', endedAt: '2026-10-03T15:55:00.000Z', result: { winnerAthleteId: 100, winType: 'points' } })
    const feed = snapshotFeed(oneMat({ current: done, bound: false }, [settled, done]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).queryByRole('button', { name: 'Enter the result' })).not.toBeInTheDocument()
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
    // I4: the press carries a client id, so the server dedupes a press that arrives twice.
    const skip = f.calls.find(c => c.url === '/api/matches/10/skip')!
    expect(JSON.parse(String(skip.init?.body)).id).toMatch(/^[A-Za-z0-9-]{8,64}$/)
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
    // The stream is the source for the status (I5), so the snapshot says setup too.
    const base = oneMat({ current: null, bound: false }, [settled])
    const feed = snapshotFeed({ ...base, event: { ...base.event, status: 'setup' } })
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

  /**
   * G03. Both tabs ask the one question through the one dialog, so the Live tab now names
   * the mats a finish would cut off. The sentence it replaced said the opposite of what
   * happens: a finished event refuses every write, so a match left running is not a match
   * that stays where it is, it is a result nobody can record.
   */
  it('names the mats still on a match in the shared finish dialog', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url), withLiveMat)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Finish event' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Finish the event?')).toBeInTheDocument()
    expect(within(dialog).getByText(/mat is still on a match/)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('1 mat is still on a match.')
    expect(within(dialog).getByText('Mateo Rivera vs Olivia Kim')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Keep scoring' })).toBeInTheDocument()
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
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', mode: 'live', matCount: 1, contact: null, certifiedAt: null, far: null },
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
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', mode: 'live', matCount: 1, contact: null, certifiedAt: null, far: null },
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

// The PIN is six separate wells, so a code is typed one digit into one well at a time,
// the same way PinGate's own suite does it.
async function typeCode(user: ReturnType<typeof userEvent.setup>, host: HTMLElement, digits: string) {
  // The six wells are the first textboxes in the dialog; the Reason field follows them.
  const wells = within(host).getAllByRole('textbox').slice(0, digits.length)
  for (let i = 0; i < digits.length; i++) {
    await user.clear(wells[i])
    await user.type(wells[i], digits[i])
  }
}

describe('LiveTab certification', () => {
  const certifiedAt = new Date(2026, 9, 3, 16, 12).toISOString()

  const record = (status: EventStatus, over: Partial<Snapshot['event']> = {}) => snapshotFeed(sampleSnapshot({
    now: SERVER_NOW,
    event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status, mode: 'live', matCount: 1, contact: null, certifiedAt: null, far: null, ...over },
    teams: [
      { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 42 },
      { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 31 },
    ],
    mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
    matches: [settled],
  }))

  const finishedDetail = (status: EventStatus, over: Partial<EventDetail['event']> = {}): EventDetail =>
    ({ ...detail, event: { ...detail.event, status, ...over } })

  it('offers one primary control on a finished event, and says corrections are still open', async () => {
    const feed = record('done')
    mount(url => feed.handle(url) ?? connectOnly(url), finishedDetail('done'))
    expect(await screen.findByRole('button', { name: 'Certify results' })).toBeInTheDocument()
    expect(screen.getByText(FINISHED_LINE)).toBeInTheDocument()
  })

  /**
   * The history is the record's own account of itself, so it is reachable in both
   * finished states. Hanging the whole overflow off certified put it out of reach on a
   * done event and took it away again on every unlock, which is exactly when somebody
   * wants to read what happened.
   */
  it('reaches the event history on a finished event, with no unlock to offer yet', async () => {
    const feed = record('done')
    const f = mount(url => feed.handle(url) ?? (url.endsWith('/history') ? { json: [] } : connectOnly(url)), finishedDetail('done'))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Event actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Unlock the results' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Event history' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Event history')
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/1/history')).toBe(true))
  })

  it('asks for the PIN again, and only enables the write at six digits', async () => {
    const feed = record('done')
    mount(url => feed.handle(url) ?? connectOnly(url), finishedDetail('done'))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Certify results' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Certify the results?')).toBeInTheDocument()
    expect(within(dialog).getByText(/Every change on this event is refused/)).toBeInTheDocument()
    expect(within(dialog).getByText(/a laptop left open at the desk cannot certify by itself/)).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Certify results' })
    expect(confirm).toBeDisabled()
    await typeCode(user, dialog, '274193')
    expect(confirm).toBeEnabled()
  })

  it('posts the PIN and repaints the toolbar from the write, not from the next poll', async () => {
    const feed = record('done')
    const f = mount(url => feed.handle(url) ?? (url.endsWith('/certify')
      ? { json: { ...detail, event: { ...detail.event, status: 'certified', certifiedAt } } }
      : connectOnly(url)), finishedDetail('done'))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Certify results' }))
    const dialog = await screen.findByRole('dialog')
    await typeCode(user, dialog, '274193')
    await user.click(within(dialog).getByRole('button', { name: 'Certify results' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/1/certify')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/1/certify'))).toEqual({ pin: '274193' })
    expect(await screen.findByText(/^Certified/)).toBeInTheDocument()
    expect(screen.getByText('4:12 pm')).toBeInTheDocument()
  })

  it('shows a wrong PIN inside the dialog it was asked for in', async () => {
    const feed = record('done')
    mount(url => feed.handle(url) ?? (url.endsWith('/certify')
      ? { status: 401, json: { error: { code: 'bad_pin', message: 'wrong PIN' } } }
      : connectOnly(url)), finishedDetail('done'))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Certify results' }))
    const dialog = await screen.findByRole('dialog')
    await typeCode(user, dialog, '000000')
    await user.click(within(dialog).getByRole('button', { name: 'Certify results' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('wrong PIN')
  })

  it('prints the time of the signature and no primary control once certified', async () => {
    const feed = record('certified', { certifiedAt })
    mount(url => feed.handle(url) ?? connectOnly(url), finishedDetail('certified', { certifiedAt }))
    expect(await screen.findByText('4:12 pm')).toBeInTheDocument()
    expect(screen.getByText('This event is certified. The record lives at /board/1.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Certify results' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finish event' })).not.toBeInTheDocument()
  })

  it('keeps unlocking in the overflow, beside the event history', async () => {
    const feed = record('certified', { certifiedAt })
    const f = mount(url => feed.handle(url) ?? (url.endsWith('/history') ? { json: [] } : connectOnly(url)), finishedDetail('certified', { certifiedAt }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Event actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Unlock the results' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Event history' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Event history')
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/1/history')).toBe(true))
  })

  /**
   * The toolbar pins the write's own answer so it does not keep offering Certify results
   * for the seconds before the next poll. The pin has to be released by the stream MOVING,
   * not by it reporting the status this write produced: a second device that flips the
   * event back inside the same poll means the stream never reports that status at all, and
   * a pin waiting for it stands forever over a record that has changed underneath it.
   */
  it('lets go of a pinned signature when another device unlocks inside the same poll', async () => {
    const feed = record('done')
    mount(url => feed.handle(url) ?? (url.endsWith('/certify')
      ? { json: { ...detail, event: { ...detail.event, status: 'certified', certifiedAt } } }
      : connectOnly(url)), finishedDetail('done'))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Certify results' }))
    const dialog = await screen.findByRole('dialog')
    await typeCode(user, dialog, '274193')
    await user.click(within(dialog).getByRole('button', { name: 'Certify results' }))
    expect(await screen.findByText(/^Certified/)).toBeInTheDocument()

    // The other desk unlocked before this browser's next poll, so the event never reaches
    // certified on the stream. It still moves, which is what releases the pin.
    feed.push(sampleSnapshot({
      now: SERVER_NOW,
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', mode: 'live', matCount: 1, contact: null, certifiedAt: null, far: null },
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 42 },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 31 },
      ],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
      matches: [settled],
    }))
    expect(await screen.findByRole('button', { name: 'Certify results' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByText(/^Certified/)).not.toBeInTheDocument()
  })

  it('lets go of a pinned unlock when another device certifies inside the same poll', async () => {
    const feed = record('certified', { certifiedAt })
    mount(url => feed.handle(url) ?? (url.endsWith('/uncertify')
      ? { json: { ...detail, event: { ...detail.event, status: 'done', certifiedAt: null } } }
      : connectOnly(url)), finishedDetail('certified', { certifiedAt }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Event actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Unlock the results' }))
    const dialog = await screen.findByRole('dialog')
    await typeCode(user, dialog, '274193')
    await user.type(within(dialog).getByLabelText(/^Reason/), 'mat 2 typed the wrong winner')
    await user.click(within(dialog).getByRole('button', { name: 'Unlock the results' }))
    expect(await screen.findByRole('button', { name: 'Certify results' })).toBeInTheDocument()

    feed.push(sampleSnapshot({
      now: SERVER_NOW,
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'certified', mode: 'live', matCount: 1, contact: null, certifiedAt, far: null },
      teams: [
        { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 7, points: 42 },
        { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 5, points: 31 },
      ],
      mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }],
      matches: [settled],
    }))
    expect(await screen.findByText(/^Certified/, undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Certify results' })).not.toBeInTheDocument()
  })

  it('takes a PIN and a reason before it will unlock, and posts both', async () => {
    const feed = record('certified', { certifiedAt })
    const f = mount(url => feed.handle(url) ?? (url.endsWith('/uncertify')
      ? { json: { ...detail, event: { ...detail.event, status: 'done', certifiedAt: null } } }
      : connectOnly(url)), finishedDetail('certified', { certifiedAt }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Event actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Unlock the results' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Unlock the results' })
    await typeCode(user, dialog, '274193')
    // The PIN alone is not enough: an unlocked record has to say why it was.
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/^Reason/), 'mat 2 typed the wrong winner')
    expect(within(dialog).getByText(`28 / ${CORRECTION_REASON_MAX}`)).toBeInTheDocument()
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/1/uncertify')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/1/uncertify')))
      .toEqual({ pin: '274193', reason: 'mat 2 typed the wrong winner' })
    expect(await screen.findByRole('button', { name: 'Certify results' })).toBeInTheDocument()
  })

  it('maps a refused write on a certified event to the one sentence', async () => {
    const feed = snapshotFeed(oneMat({ current: null, onDeck: [onDeckMatch(20, 'Ivy Cole', 'Jonah Reed')] }))
    mount(url => feed.handle(url) ?? (url.endsWith('/advance')
      ? { status: 409, json: { error: { code: 'match_state', message: 'event is certified' } } }
      : connectOnly(url)))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Call the next match' }))
    expect(await screen.findByText(CERTIFIED_REFUSAL)).toBeInTheDocument()
  })

  it('opens the last result on a mat from the panel overflow', async () => {
    const feed = snapshotFeed(oneMat({ current: null }, [settled]))
    const f = mount(url => feed.handle(url) ?? (url.endsWith('/history') ? { json: [] } : connectOnly(url)))
    const user = userEvent.setup()
    await openMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Match history' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Mat 1, Mateo Rivera vs Olivia Kim')
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/9/history')).toBe(true))
  })

  it('refuses the panel history when the mat has recorded nothing', async () => {
    const feed = snapshotFeed(oneMat({ current: null }, []))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const user = userEvent.setup()
    await openMenu(user, 1)
    expect(await screen.findByRole('menuitem', { name: 'Match history' })).toHaveAttribute('data-disabled')
  })
})

const entryDetail: EventDetail = { ...detail, event: { ...detail.event, mode: 'entry' } }
const atMode = (snapshot: Snapshot, mode: EventMode): Snapshot => ({ ...snapshot, event: { ...snapshot.event, mode } })

describe('LiveTab in entry mode', () => {
  // The tab is never hidden: an organizer still wants to look at the running order, and a
  // hidden tab is a screen somebody hunts for. It has to say what it is instead.
  it('states that the event runs from the desk rather than handing out a mat code', async () => {
    const feed = snapshotFeed(atMode(oneMat({ current: null, bound: false }, [settled]), 'entry'))
    const f = mount(url => feed.handle(url) ?? connectOnly(url), entryDetail)
    expect(await screen.findByText(DESK_NOTE)).toBeInTheDocument()
    expect(screen.getByText(DESK_NOTE_DETAIL)).toBeInTheDocument()
    expect(await panel(1)).toBeInTheDocument()
    expect(screen.getByText(/No iPad is scoring these mats/)).toBeInTheDocument()

    // A mat code on this screen is an invitation to bind a tablet that will sit on an
    // empty mat all afternoon, so neither the code nor the QR is rendered or even fetched.
    expect(screen.queryByText('0420')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'QR code' })).not.toBeInTheDocument()
    expect(f.calls.some(c => c.url.endsWith('/connect'))).toBe(false)
  })

  it('keeps the connect card and its code in live mode', async () => {
    const feed = snapshotFeed(oneMat({ current: null, bound: false }, [settled]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await screen.findByText('0420')).toBeInTheDocument()
    expect(screen.queryByText(DESK_NOTE)).not.toBeInTheDocument()
    expect(screen.queryByText(/No iPad is scoring these mats/)).not.toBeInTheDocument()
  })

  /**
   * G10. No tablet ever binds in desk mode and no match ever goes live, so every bound
   * check reported a fault that is the configuration working as designed: the rack read
   * amber "No scorer" or "No match" on every panel, all afternoon. The panel keeps
   * its lanes, because the running order per mat is how the desk answers when a child is
   * up, and drops only the parts that belong to a tablet.
   */
  it('drops the bound checks, the amber and the primary control on every panel', async () => {
    const deck = [onDeckMatch(11, 'Ava Park', 'Noah Tran'), onDeckMatch(12, 'Emma Cole', 'Ben Ortiz')]
    const feed = snapshotFeed(atMode(
      oneMat({ current: null, onDeck: deck, bound: false }, [settled, ...deck]),
      'entry',
    ))
    mount(url => feed.handle(url) ?? connectOnly(url), entryDetail)
    const one = await panel(1)
    expect(one).toHaveAttribute('data-state', 'neutral')
    expect(within(one).getByText(DESK_PANEL_WORD)).toBeInTheDocument()
    expect(within(one).getByText(deskMatNote(1))).toBeInTheDocument()
    expect(within(one).queryByText('No scorer')).not.toBeInTheDocument()
    expect(within(one).queryByText('No match')).not.toBeInTheDocument()
    expect(within(one).queryByText('No match on this mat')).not.toBeInTheDocument()

    // The NEXT lane still carries that mat's designed order, and the LAST RESULT lane
    // still carries what the desk typed.
    expect(within(one).getByText('Ava Park')).toBeInTheDocument()
    expect(within(one).getByText('Emma Cole vs Ben Ortiz')).toBeInTheDocument()
    expect(within(one).getByText('Mateo Rivera beat Olivia Kim by submission')).toBeInTheDocument()

    // Nothing on the panel binds, ends or calls a match, so it offers no press at all.
    expect(within(one).queryByRole('button', { name: 'Call the next match' })).not.toBeInTheDocument()
    expect(within(one).queryByRole('button', { name: 'End match' })).not.toBeInTheDocument()
  })

  it('says the mat is complete once its designed order runs out', async () => {
    const feed = snapshotFeed(atMode(oneMat({ current: null, bound: false }, [settled]), 'entry'))
    mount(url => feed.handle(url) ?? connectOnly(url), entryDetail)
    const one = await panel(1)
    expect(within(one).getByText('Mat 1 complete')).toBeInTheDocument()
  })

  /**
   * One fact, one source. The organizer switches the event from a phone at the desk. This
   * laptop's event detail is a react-query cache that nothing invalidates on another
   * device's write, so a tab reading the detail went on offering a mat code and a QR for
   * a rack the television had already stopped showing.
   */
  it('follows the polled stream when the detail cache still says the mats are scoring', async () => {
    // A running clock, so the stream is on its one second rung and the switch lands on
    // the next tick rather than three seconds later.
    const feed = snapshotFeed(oneMat({ bound: false }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await screen.findByText('0420')).toBeInTheDocument()

    feed.push(atMode(oneMat({ bound: false }), 'entry'))
    expect(await screen.findByText(DESK_NOTE, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('0420')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'QR code' })).not.toBeInTheDocument()
    expect(screen.getByText(/No iPad is scoring these mats/)).toBeInTheDocument()
  })
})

// 6.18: below 640px every dialog in the product goes full screen. The End dialog was the
// one that stayed a centred rounded card, and a tie is exactly the moment the organizer is
// deciding on a phone at the desk.
describe('LiveTab dialogs, 6.18', () => {
  const goesFullScreenBelow640 = (dialog: HTMLElement) => {
    expect(dialog.className).toMatch(/(^|\s)max-w-none(\s|$)/)
    expect(dialog.className).toMatch(/(^|\s)rounded-none(\s|$)/)
    expect(dialog.className).toMatch(/(^|\s)sm:rounded-xl(\s|$)/)
  }

  it('puts the End dialog on the shared frame', async () => {
    const tied = scored({
      a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: null, weightLbs: null, score: 3 },
      b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: null, weightLbs: null, score: 3 },
    })
    const feed = snapshotFeed(oneMat({ current: tied, bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    await userEvent.setup().click(within(one).getByRole('button', { name: 'End match' }))
    goesFullScreenBelow640(await screen.findByRole('dialog'))
  })

  it('puts the Finish dialog on the shared frame', async () => {
    const feed = snapshotFeed(oneMat({ bound: true }))
    mount(url => feed.handle(url) ?? connectOnly(url))
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Finish event' }))
    goesFullScreenBelow640(await screen.findByRole('dialog'))
  })
})

describe('LiveTab after the whole-branch review', () => {
  // C3: a switch to the desk leaves whatever was on a mat exactly where it is, and the
  // panel used to print the desk sentence over two children who were still on the mat and
  // call the mat complete one lane down.
  it('keeps a mid-match pair on a desk event panel and says where its result goes', async () => {
    const paused = scored({ clock: { elapsedMs: 40_000, startedAt: null, lengthMs: 300_000 } })
    const feed = snapshotFeed(atMode(oneMat({ current: paused, bound: false }, [settled, paused]), 'entry'))
    mount(url => feed.handle(url) ?? connectOnly(url), entryDetail)
    const one = await panel(1)
    expect(within(one).getByText('Mid-match')).toBeInTheDocument()
    expect(within(one).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(one).getByText('Type this result on the Entry tab.')).toBeInTheDocument()
    expect(within(one).queryByText('Mat 1 complete')).not.toBeInTheDocument()
    expect(within(one).queryByRole('button', { name: 'End match' })).not.toBeInTheDocument()
  })

  // M10: a mat created after Start that nothing was ever put on is empty, not finished.
  it('calls a mat empty, not complete, when no match was ever put on it', async () => {
    const feed = snapshotFeed(oneMat({ current: null, bound: false }, [{ ...settled, matId: 2 }]))
    mount(url => feed.handle(url) ?? connectOnly(url))
    const one = await panel(1)
    expect(within(one).getByText('Empty')).toBeInTheDocument()
    expect(within(one).getByText('Nothing queued on mat 1')).toBeInTheDocument()
    expect(within(one).queryByText('Mat 1 complete')).not.toBeInTheDocument()
  })

  // M9: the panel repaints the instant the advance succeeds, so a second tap in that gap
  // was refused for a press that worked. The control stays busy until the stream carries
  // the version the write returned.
  it('keeps Call the next match busy until the stream carries the advance', async () => {
    const next = onDeckMatch(11, 'Emma Cole', 'Ben Ortiz')
    const feed = snapshotFeed(oneMat({ current: null, onDeck: [next], bound: false }))
    mount((url, init) => {
      if (url === '/api/mats/1/advance' && init?.method === 'POST') return { json: { match: null, version: 50 } }
      return feed.handle(url) ?? connectOnly(url)
    })
    const user = userEvent.setup()
    const one = await panel(1)
    await user.click(within(one).getByRole('button', { name: 'Call the next match' }))
    await vi.waitFor(() => expect(within(one).getByRole('button', { name: 'Call the next match' })).toBeDisabled())
  })

  // I5: a Finish pressed on a second device reaches this tab through the stream and never
  // through the detail cache, which nothing invalidates.
  it('reads the event status off the stream, not the detail cache', async () => {
    const base = oneMat({ current: null, bound: false }, [settled])
    const feed = snapshotFeed({ ...base, event: { ...base.event, status: 'done' } })
    mount(url => feed.handle(url) ?? connectOnly(url))
    expect(await screen.findByText('Final result')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finish event' })).not.toBeInTheDocument()
  })
})
