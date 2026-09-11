import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Snapshot } from '@shared/types'
import { SetupMatchesStep } from '@/routes/event/SetupMatchesStep'
import { SnapshotStreamContext } from '@/lib/useSnapshot'
import { setAdminToken } from '@/lib/auth'
import type { AthleteRow, EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch, sampleSnapshot, type Reply } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): AthleteRow => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 9, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
})

const ROSTER = [
  kid(100, 1, 'Mateo', 'Alvarez'), kid(101, 1, 'Kai', 'Castellano'),
  kid(200, 2, 'Olivia', 'Brandt'), kid(201, 2, 'Ava', 'Delgado'),
]

function detailWith(matches: MatchRow[]): EventDetail {
  return {
    event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', status: 'setup', mode: 'live', sameGender: false, createdAt: 'x' },
    teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
    athletes: ROSTER,
    rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
    mats: [{ id: 1, eventId: 7, number: 1, currentMatchId: null }, { id: 2, eventId: 7, number: 2, currentMatchId: null }],
    matches,
    candidateCount: 0,
  }
}

const QUIET = sampleSnapshot({ mats: [], matches: [] })

// The step reads the shared stream every tab reads, so the fixture provides one rather than
// letting the component open a second poll loop of its own.
function stream(snapshot: Snapshot) {
  return {
    eventId: 7,
    state: {
      snapshot, live: snapshot, connected: true, lastSuccessAt: Date.now(),
      paused: false, waiting: 0, setPaused: () => {},
    },
  }
}

function mount(detail: EventDetail, opts: { snapshot?: Snapshot; onClose?: () => void; reply?: (url: string, init?: RequestInit) => Reply | undefined } = {}) {
  const f = fakeFetch((url, init) => opts.reply?.(url, init)
    ?? (url === '/api/events/7/proposals' ? { json: [] } : { json: {} }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <SnapshotStreamContext value={stream(opts.snapshot ?? QUIET)}>
        <SetupMatchesStep detail={detail} open onClose={opts.onClose ?? (() => {})} />
      </SnapshotStreamContext>
    </QueryClientProvider>,
  )
  return { f }
}

const posted = (f: { calls: { url: string; init?: RequestInit }[] }, url: string) =>
  f.calls.filter(c => c.url === url && c.init?.method === 'POST').length

describe('SetupMatchesStep', () => {
  it('states what the proposer has to work with, and marks itself step three', async () => {
    mount(detailWith([]))
    await screen.findByText('Assign the matches')
    expect(screen.getByText(/competitors across/)).toHaveTextContent('4 competitors across 2 teams.')
    expect(screen.getByText('3 Matches')).toHaveAttribute('aria-current', 'step')
  })

  // The step carries the panel the Matches tab carries, so an organizer learns the one
  // control they will use all afternoon rather than a button that exists only here.
  it('proposes from the panel the Matches tab carries', async () => {
    const { f } = mount(detailWith([]), {
      reply: (url, init) => (url === '/api/events/7/proposals' && init?.method === 'POST' ? { json: [] } : undefined),
    })
    const user = userEvent.setup()
    await screen.findByText('Assign the matches')
    expect(await screen.findByText('No proposals yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Propose matches' }))
    await vi.waitFor(() => expect(posted(f, '/api/events/7/proposals')).toBe(1))
    expect(await screen.findByText('Nothing left to pair.')).toBeInTheDocument()
  })

  it('reports a refused propose in the step, in the server sentence', async () => {
    mount(detailWith([]), {
      reply: (url, init) => (url === '/api/events/7/proposals' && init?.method === 'POST'
        ? { status: 422, json: { error: { code: 'validation', message: 'no competitors to pair' } } }
        : undefined),
    })
    const user = userEvent.setup()
    await screen.findByText('Assign the matches')
    await user.click(await screen.findByRole('button', { name: 'Propose matches' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no competitors to pair')
  })

  it('hands the event over from either footer control', async () => {
    const onClose = vi.fn()
    mount(detailWith([]), { onClose })
    const user = userEvent.setup()
    await screen.findByText('Assign the matches')
    await user.click(screen.getByRole('button', { name: 'Open the event' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
