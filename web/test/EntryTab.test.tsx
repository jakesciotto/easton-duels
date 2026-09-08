import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EntryTab, FEWER_POINTS_LINE } from '@/routes/event/EntryTab'
import { saveDraft } from '@/routes/event/entry-state'
import { setAdminToken } from '@/lib/auth'
import { CERTIFIED_ENTRY_LINE, CERTIFIED_REFUSAL_BODY, CERTIFIED_REFUSAL_TITLE, FINISHED_LINE } from '@/lib/eventMode'
import { HISTORY_NOTE } from '@/routes/event/MatchHistorySheet'
import { useEventDetail } from '@/lib/queries'
import { SnapshotStreamContext, type StreamState } from '@/lib/useSnapshot'
import type { Snapshot } from '@shared/types'
import type { EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch, sampleSnapshot } from './fakes'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): EventDetail['athletes'][number] => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
})
const match = (id: number, over: Partial<MatchRow> = {}): MatchRow => ({
  id, eventId: 7, matId: null, orderIndex: id, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200, status: 'pending',
  winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null, ...over,
})
const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran')],
  rulesets: [], mats: [],
  matches: [match(1, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }), match(2, { athleteAId: 101, athleteBId: 201 })],
  candidateCount: 0,
}

// The event body owns the one poll for the event and every tab under it reads that
// stream, so the tab is always mounted under a provider and never starts a poll of its
// own. A null snapshot is the state before the first tick, where the stored mode rules.
const stream = (snapshot: Snapshot | null = null): StreamState => ({
  snapshot, connected: true, lastSuccessAt: null, paused: false, waiting: 0, setPaused: () => {}, live: snapshot,
})

function mount(d: EventDetail = detail, view: Snapshot | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SnapshotStreamContext value={{ eventId: d.event.id, state: stream(view) }}>
        <EntryTab detail={d} />
      </SnapshotStreamContext>
    </QueryClientProvider>,
  )
}

// The tab as the event body actually mounts it: the detail arrives through
// useEventDetail, so a save's refetch has to travel back through 4.4's held commit
// before the ledger and the running score can report it.
function LiveEntry({ eventId }: { eventId: number }) {
  const q = useEventDetail(eventId)
  return q.data ? <EntryTab detail={q.data} /> : null
}

function mountLive() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SnapshotStreamContext value={{ eventId: 7, state: stream() }}>
        <LiveEntry eventId={7} />
      </SnapshotStreamContext>
    </QueryClientProvider>,
  )
}

// The two competitor fields are the Select primitive, so a pick is a click on the
// combobox and a click on its option, the same shape every other dialog uses.
async function pick(user: UserEvent, field: string, name: string) {
  await user.click(screen.getByRole('combobox', { name: field }))
  await user.click(await screen.findByRole('option', { name }))
}
// The label is the confirmation channel, so it reads Save, Saving or Saved
// depending on where the round trip is.
const saveButton = () => screen.getByRole('button', { name: /^Sav/ })
const draft = () => JSON.parse(sessionStorage.getItem('duels:entry:7') ?? 'null')
const correctionDraft = (matchId: number) => sessionStorage.getItem(`duels:entry:7:match:${matchId}`)

describe('EntryTab', () => {
  it('posts a new entry with the default winner, confirms in words, and clears the form', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2')
    expect(screen.getByRole('button', { name: 'Ava Park wins' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'On points' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/entries')).toBe(true))
    const posted = f.body(f.calls.findIndex(c => c.url === '/api/events/7/entries'))
    expect(posted).toMatchObject({ athleteAId: 101, athleteBId: 201, pointsA: 5, pointsB: 2, winnerAthleteId: 101, winType: 'points' })
    expect(posted.entryId).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    // The confirmation is a word from the response, not the form clearing.
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getByText(/^Saved\. Ava Park beat Noah Tran on points, 5 to 2\.$/)).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByLabelText('Ridgeline points')).toHaveValue(''))
  })

  it('shows the running team score for both teams', () => {
    mount()
    const score = screen.getByRole('region', { name: 'Running team score' })
    expect(within(score).getByText('Ridgeline')).toBeInTheDocument()
    expect(within(score).getByText('1')).toBeInTheDocument()
    expect(within(score).getByText('0')).toBeInTheDocument()
  })

  it('blocks save on a tie until a winner is picked, then sends a decision', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Mateo Rivera')
    await pick(user, 'Lakeside competitor', 'Olivia Kim')
    await user.type(screen.getByLabelText('Ridgeline points'), '2')
    await user.type(screen.getByLabelText('Lakeside points'), '2')
    expect(saveButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Olivia Kim wins' }))
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBeGreaterThan(0))
    expect(f.body(0)).toMatchObject({ winnerAthleteId: 200, winType: 'decision' })
  })

  it('lists results newest first, loads one for editing, and posts the correction', async () => {
    const f = fakeFetch(() => ({ json: { match: { id: 1 }, version: 2 } }))
    mount()
    const user = userEvent.setup()
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getByText('newest first', { exact: false })).toBeInTheDocument()
    await user.click(within(results).getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' }))
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('4')
    await user.clear(screen.getByLabelText('Lakeside points'))
    await user.type(screen.getByLabelText('Lakeside points'), '4')
    await user.click(screen.getByRole('button', { name: 'Olivia Kim wins' }))
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/1/entry')).toBe(true))
    // The loaded win type ('points') is a pick that survives the points edit and the
    // winner change below: only an explicit win-type pick changes it, per spec 9.2.
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/1/entry'))).toMatchObject({ pointsA: 4, pointsB: 4, winnerAthleteId: 200, winType: 'points' })
  })

  it('keeps the loaded win type through a points correction', async () => {
    const submissionDetail: EventDetail = {
      ...detail,
      matches: [match(3, { status: 'done', pointsA: 2, pointsB: 4, winnerAthleteId: 100, winType: 'submission' })],
    }
    const f = fakeFetch(() => ({ json: { match: { id: 3 }, version: 2 } }))
    mount(submissionDetail)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' }))
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('2')
    expect(screen.getByRole('button', { name: 'By submission' })).toHaveAttribute('aria-pressed', 'true')
    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '3')
    expect(screen.getByRole('button', { name: 'By submission' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/3/entry')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/3/entry'))).toMatchObject({ pointsA: 3, pointsB: 4, winnerAthleteId: 100, winType: 'submission' })
  })

  it('offers pending pairs and a start banner in setup', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(screen.getByRole('combobox', { name: 'Ridgeline competitor' })).toHaveTextContent('Ava Park')
    expect(screen.getByRole('combobox', { name: 'Lakeside competitor' })).toHaveTextContent('Noah Tran')
    await user.click(screen.getByRole('button', { name: 'Start event' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7' && c.init?.method === 'PATCH')).toBe(true))
  })

  it('tabs through the form in the order spec 9.2 requires', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Mateo Rivera')
    await pick(user, 'Lakeside competitor', 'Olivia Kim')
    // A tied 0-0 score leaves no auto-derived winner, which disables Save and
    // removes it from the tab order (disabled buttons are never tabbable), so
    // give the score a real winner to keep Save reachable at the end.
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2')

    const order = [
      screen.getByRole('combobox', { name: 'Ridgeline competitor' }),
      screen.getByRole('combobox', { name: 'Lakeside competitor' }),
      screen.getByLabelText('Ridgeline points'),
      screen.getByLabelText('Lakeside points'),
      screen.getByRole('button', { name: 'Mateo Rivera wins' }),
      screen.getByRole('button', { name: 'Olivia Kim wins' }),
      screen.getByRole('button', { name: 'On points' }),
      screen.getByRole('button', { name: 'By submission' }),
      screen.getByRole('button', { name: 'By decision' }),
      saveButton(),
    ]
    expect(saveButton()).toBeEnabled()
    order[0].focus()
    for (const el of order.slice(1)) {
      await user.tab()
      expect(document.activeElement).toBe(el)
    }
  })

  it('takes single key shortcuts for points, the winner, the win type and Save', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Mateo Rivera')
    await pick(user, 'Lakeside competitor', 'Olivia Kim')

    // A digit typed anywhere outside a field starts the Ridgeline well and moves
    // focus into it, so the operator never hunts for the first box.
    screen.getByRole('button', { name: 'By decision' }).focus()
    await user.keyboard('7')
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('7')
    expect(document.activeElement).toBe(screen.getByLabelText('Ridgeline points'))

    // Letters are read inside the wells too, which take digits only.
    await user.keyboard('1b')
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('71')
    expect(screen.getByRole('button', { name: 'Olivia Kim wins' })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('s')
    expect(screen.getByRole('button', { name: 'By submission' })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    expect(f.body(0)).toMatchObject({ pointsA: 71, pointsB: 0, winnerAthleteId: 200, winType: 'submission' })
  })

  it('holds one entryId across a failed attempt, persists it, and mints a new one only on a 2xx', async () => {
    let broken = true
    const f = fakeFetch(() => broken
      ? { status: 500, json: { error: { code: 'internal', message: 'boom' } } }
      : { status: 201, json: { match: { id: 9 }, version: 3 } })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '6')
    await user.click(saveButton())

    await screen.findByText('The server had a problem')
    const first = f.body(0).entryId as string
    expect(draft().entryId).toBe(first)
    expect(draft()).toMatchObject({ aId: '101', bId: '201', pointsA: '6' })

    broken = false
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(f.body(1).entryId).toBe(first)
    // Cleared only on a 2xx, so the next fill mints the next id.
    await vi.waitFor(() => expect(sessionStorage.getItem('duels:entry:7')).toBeNull())
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Olivia Kim')
    await user.type(screen.getByLabelText('Ridgeline points'), '3')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(3))
    expect(f.body(2).entryId).not.toBe(first)
  })

  it('re-enables Save after a failure and reuses the persisted entryId after a remount', async () => {
    const f = fakeFetch(() => ({ status: 500, json: { error: { code: 'internal', message: 'boom' } } }))
    const view = mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '4')
    await user.click(saveButton())
    await screen.findByText('The server had a problem')
    // Every terminal outcome re-enables Save, including failure: a disabled Save
    // would leave a reload as the only recourse, and a reload mints a new id.
    expect(saveButton()).toBeEnabled()
    const first = f.body(0).entryId as string

    view.unmount()
    mount()
    expect(screen.getByText('This entry never sent')).toBeInTheDocument()
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('4')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(f.body(1).entryId).toBe(first)
  })

  it('re-enables Save when the server never answers', async () => {
    // The one path that would otherwise strand the desk: a POST that neither
    // resolves nor rejects. Timers go fake only after the form is filled, because
    // the async queries above run on real ones.
    fakeFetch(() => new Promise<never>(() => {}))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')

    vi.useFakeTimers()
    try {
      fireEvent.click(saveButton())
      // react-query notifies through a setTimeout, so the pending render only
      // lands once the fake clock moves at all.
      await act(async () => { vi.advanceTimersByTime(1) })
      expect(saveButton()).toBeDisabled()
      await act(async () => { vi.advanceTimersByTime(8_100) })
      expect(saveButton()).toBeEnabled()
      expect(screen.getByText('Could not reach the server')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * G28 / 7.12. The banner said "Press Save to try again when the connection returns" and
   * nothing retried, so an entry typed during a wifi drop sat on the screen until somebody
   * happened to press the button again. The tab now re-sends the same write, with the same
   * held entryId, five seconds after each failed answer.
   */
  it('retries the same write every 5 seconds while the server cannot be reached', async () => {
    let reachable = false
    const f = fakeFetch(async () => {
      if (!reachable) throw new TypeError('Failed to fetch')
      return { status: 201, json: { match: { id: 9 }, version: 1 } }
    })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')

    vi.useFakeTimers()
    try {
      fireEvent.click(saveButton())
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(f.calls.length).toBe(1)
      expect(screen.getByText(/Retrying every 5 seconds\./)).toBeInTheDocument()
      // Between attempts the desk can still press Save itself.
      expect(saveButton()).toBeEnabled()

      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(f.calls.length).toBe(2)
      expect(f.body(1).entryId).toBe(f.body(0).entryId)

      reachable = true
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(f.calls.length).toBe(3)
      expect(screen.queryByText(/Retrying every 5 seconds\./)).not.toBeInTheDocument()

      // Stopped on success: nothing is re-sent over a result the server already stored.
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
      expect(f.calls.length).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('disables Save while a retry is in flight', async () => {
    const f = fakeFetch(async (url) => {
      if (url !== '/api/events/7/entries') return { json: {} }
      if (f.calls.filter(c => c.url === url).length > 1) return new Promise<never>(() => {})
      throw new TypeError('Failed to fetch')
    })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')

    vi.useFakeTimers()
    try {
      fireEvent.click(saveButton())
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(saveButton()).toBeEnabled()
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(saveButton()).toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  // A refusal the server answered is not a connection problem, and re-sending it would
  // only ask for the same refusal every five seconds for the rest of the afternoon.
  it('stops retrying the moment the server refuses', async () => {
    let refuse = false
    const f = fakeFetch(async () => {
      if (!refuse) throw new TypeError('Failed to fetch')
      return { status: 422, json: { error: { code: 'validation', message: 'that pair is not on this event' } } }
    })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')

    vi.useFakeTimers()
    try {
      fireEvent.click(saveButton())
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      refuse = true
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(f.calls.length).toBe(2)
      expect(screen.getByText('That result cannot be saved')).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(f.calls.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // The retry re-sends the press it was armed on. Once the desk has changed the form that
  // press is no longer the result they mean, so the next Save is the one that says so.
  it('stops retrying when the desk edits the form', async () => {
    const f = fakeFetch(async () => { throw new TypeError('Failed to fetch') })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))

    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '7')

    vi.useFakeTimers()
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(f.calls.length).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * G30. A 5 to 2 match won by the side with 2 recorded as won on points and nothing said
   * so. The pick is never refused, because kids submit from behind all afternoon: it takes
   * the win type with it and asks the desk to confirm.
   */
  it('clears the win type to submission when the trailing side is picked as the winner', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2')
    expect(screen.getByRole('button', { name: 'On points' })).toHaveAttribute('data-pressed')
    expect(screen.queryByText(FEWER_POINTS_LINE)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Noah Tran wins/ }))
    expect(screen.getByRole('button', { name: 'By submission' })).toHaveAttribute('data-pressed')
    expect(screen.getByRole('button', { name: 'On points' })).not.toHaveAttribute('data-pressed')
    expect(screen.getByText(FEWER_POINTS_LINE)).toBeInTheDocument()

    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    expect(f.body(0)).toMatchObject({ winnerAthleteId: 201, winType: 'submission', pointsA: 5, pointsB: 2 })
  })

  it('keeps the line up until the desk names a win type', async () => {
    fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(screen.getByRole('button', { name: /Noah Tran wins/ }))
    expect(screen.getByText(FEWER_POINTS_LINE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'By decision' }))
    expect(screen.queryByText(FEWER_POINTS_LINE)).not.toBeInTheDocument()
  })

  it('takes the line away when the points are corrected instead', async () => {
    fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(screen.getByRole('button', { name: /Noah Tran wins/ }))
    expect(screen.getByText(FEWER_POINTS_LINE)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Lakeside points'), '7')
    expect(screen.queryByText(FEWER_POINTS_LINE)).not.toBeInTheDocument()
  })

  it('says nothing when the winner is the side with the points', async () => {
    fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(screen.getByRole('button', { name: /Ava Park wins/ }))
    expect(screen.queryByText(FEWER_POINTS_LINE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'On points' })).toHaveAttribute('data-pressed')
  })

  /**
   * G31. A forty match event put forty rows under the one control this screen exists for.
   * The list is capped the way the Live queue is, states its own remainder, and names the
   * screen that holds the rest.
   */
  it('caps the pending list at eight and states the remainder', async () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      match(10 + i, { orderIndex: 10 + i, matId: 1, athleteAId: 101, athleteBId: 201 }))
    fakeFetch(() => ({ json: {} }))
    mount({ ...detail, mats: [{ id: 1, eventId: 7, number: 2, currentMatchId: null }], matches: many })

    const list = screen.getByRole('region', { name: 'Pending pairs' })
    expect(within(list).getAllByRole('button', { name: 'Use' })).toHaveLength(8)
    expect(within(list).getByText(/more on the Matches tab/)).toHaveTextContent('and 3 more on the Matches tab')
  })

  it('prints the mat and the order position on every pending row', () => {
    fakeFetch(() => ({ json: {} }))
    mount({
      ...detail,
      mats: [{ id: 1, eventId: 7, number: 2, currentMatchId: null }],
      matches: [
        match(1, { orderIndex: 0, matId: 1, athleteAId: 101, athleteBId: 201 }),
        match(2, { orderIndex: 1, matId: null, athleteAId: 100, athleteBId: 200 }),
      ],
    })

    const rows = Array.from(screen.getByRole('region', { name: 'Pending pairs' }).querySelectorAll('[data-slot="list-row"]'))
    expect(rows[0]).toHaveTextContent('Match 1')
    expect(rows[0]).toHaveTextContent('Mat 2')
    expect(rows[1]).toHaveTextContent('Match 2')
    expect(rows[1]).toHaveTextContent('No mat')
  })

  it('says nothing about a remainder while every pending pair fits', () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    expect(screen.queryByText(/more on the Matches tab/)).not.toBeInTheDocument()
  })

  it('asks once before saving the same pair inside a minute', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))

    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '2')
    await user.click(saveButton())
    expect(await screen.findByText('These two were just entered')).toBeInTheDocument()
    expect(f.calls.length).toBe(1)

    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(f.body(1)).toMatchObject({ athleteAId: 101, athleteBId: 201, pointsA: 2 })
  })

  it('does not ask again for a different pair', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))

    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Olivia Kim')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(screen.queryByText('These two were just entered')).not.toBeInTheDocument()
  })

  it('marks the winner on either side and never paints the loser as a fault', () => {
    const bothSides: EventDetail = {
      ...detail,
      matches: [
        match(1, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }),
        match(4, { athleteAId: 101, athleteBId: 201, status: 'done', pointsA: 0, pointsB: 5, winnerAthleteId: 201, winType: 'submission' }),
      ],
    }
    mount(bothSides)
    const results = screen.getByRole('region', { name: 'Results' })

    const leftWinner = within(results).getByText('Mateo Rivera').closest('[data-side="a"]')
    expect(leftWinner).toHaveAttribute('data-outcome', 'win')
    expect(within(leftWinner as HTMLElement).getByText('Winner')).toBeInTheDocument()
    const leftLoser = within(results).getByText('Olivia Kim').closest('[data-side="b"]')
    expect(leftLoser).toHaveAttribute('data-outcome', 'loss')
    expect(leftLoser).toHaveClass('text-gray-10')

    const rightWinner = within(results).getByText('Noah Tran').closest('[data-side="b"]')
    expect(rightWinner).toHaveAttribute('data-outcome', 'win')
    expect(within(rightWinner as HTMLElement).getByText('Winner')).toBeInTheDocument()
    const rightLoser = within(results).getByText('Ava Park').closest('[data-side="a"]')
    expect(rightLoser).toHaveAttribute('data-outcome', 'loss')
    expect(rightLoser).toHaveClass('text-gray-10')

    // Red means delete in this app; a ten year old losing a match is not an error.
    expect(results.innerHTML).not.toMatch(/fault|destructive/)
  })

  it('states the empty ledger with a way out of it', () => {
    mount({ ...detail, matches: [] })
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getByText('No results yet. Type the first one on the left.')).toBeInTheDocument()
  })

  // A single draft slot per event meant a correction, or cancelling one, deleted a
  // result that was typed, never sent, and still recoverable.
  it('keeps an unsent entry through a correction that is opened and cancelled', async () => {
    const f = fakeFetch(() => ({ status: 500, json: { error: { code: 'internal', message: 'boom' } } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '6')
    await user.click(saveButton())
    await screen.findByText('The server had a problem')
    const unsent = f.body(0).entryId as string
    expect(draft()).toMatchObject({ entryId: unsent, aId: '101', bId: '201', pointsA: '6', editingId: null })

    await user.click(screen.getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' }))
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('4')
    expect(draft()).toMatchObject({ entryId: unsent })

    await user.click(screen.getByRole('button', { name: 'Cancel edit' }))
    expect(draft()).toMatchObject({ entryId: unsent, aId: '101', bId: '201', pointsA: '6' })
    expect(correctionDraft(1)).toBeNull()
    // And it comes back on screen with its banner, rather than staying stored where
    // nobody can see it.
    expect(screen.getByText('This entry never sent')).toBeInTheDocument()
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('6')
  })

  it('keeps an unsent entry through a correction that saves', async () => {
    let broken = true
    const f = fakeFetch(url => url.endsWith('/entries') && broken
      ? { status: 500, json: { error: { code: 'internal', message: 'boom' } } }
      : { json: { match: { id: 1 }, version: 2 } })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '6')
    await user.click(saveButton())
    await screen.findByText('The server had a problem')
    const unsent = f.body(0).entryId as string
    broken = false

    await user.click(screen.getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' }))
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/1/entry')).toBe(true))

    await vi.waitFor(() => expect(screen.getByText('This entry never sent')).toBeInTheDocument())
    expect(draft()).toMatchObject({ entryId: unsent, aId: '101', bId: '201', pointsA: '6' })
    expect(correctionDraft(1)).toBeNull()
    expect(screen.getByLabelText('Ridgeline points')).toHaveValue('6')
  })

  // R5: opening a different correction, instead of pressing Cancel edit, used to
  // leave the outgoing one's failed slot in storage forever. It would later
  // restore under the same banner as an unsent new entry, inviting a stale
  // resend over a match that may since have been corrected properly.
  it('clears a stranded correction the moment the desk opens a different one', async () => {
    const detailR5: EventDetail = {
      ...detail,
      matches: [
        match(4, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }),
        match(5, { athleteAId: 101, athleteBId: 201, status: 'done', pointsA: 0, pointsB: 5, winnerAthleteId: 201, winType: 'submission' }),
      ],
    }
    const f = fakeFetch(url => url === '/api/matches/4/entry'
      ? { status: 500, json: { error: { code: 'internal', message: 'boom' } } }
      : { json: { match: { id: 5 }, version: 2 } })
    mount(detailR5)
    const user = userEvent.setup()

    // Open the correction on match 4, edit it, and let Save fail: this writes
    // match 4's own slot.
    await user.click(screen.getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' }))
    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '9')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await screen.findByText('The server had a problem')
    expect(correctionDraft(4)).not.toBeNull()

    // Instead of Cancel edit, the desk opens the other correction directly. The
    // outgoing slot must clear right here, before match 5's own save even runs.
    await user.click(screen.getByRole('button', { name: 'Edit Noah Tran over Ava Park' }))
    expect(correctionDraft(4)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/5/entry')).toBe(true))
    expect(correctionDraft(5)).toBeNull()
    expect(correctionDraft(4)).toBeNull()
  })

  it('clears a stranded correction when the desk leaves it for a fresh entry', async () => {
    const detailUse: EventDetail = {
      ...detail,
      matches: [
        match(4, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }),
        match(6, { athleteAId: 101, athleteBId: 201, status: 'pending' }),
      ],
    }
    fakeFetch(url => url === '/api/matches/4/entry'
      ? { status: 500, json: { error: { code: 'internal', message: 'boom' } } }
      : { json: { match: { id: 6 }, version: 2 } })
    mount(detailUse)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' }))
    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '9')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await screen.findByText('The server had a problem')
    expect(correctionDraft(4)).not.toBeNull()

    // Use is the other door out of a correction. It must close the outgoing slot
    // exactly as opening a different correction does.
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(correctionDraft(4)).toBeNull()
    expect(screen.queryByText('The server had a problem')).not.toBeInTheDocument()
  })

  // R5: a correction can still be stranded outright (the desk closes the tab
  // mid-edit after a failed save, never touching another match at all). When
  // that restores, its banner must name the match so it can never be mistaken
  // for an unsent new entry and re-sent blind.
  it('names the match in a restored correction banner, distinct from an unsent new entry', () => {
    fakeFetch(() => ({ json: {} }))
    saveDraft(7, {
      entryId: 'e-stranded-0001', aId: '100', bId: '200', pointsA: '9', pointsB: '2',
      winner: 'a', winType: 'points', editingId: 1,
    })
    mount()
    expect(screen.getByText('This correction to Mateo Rivera vs Olivia Kim never sent')).toBeInTheDocument()
    expect(screen.queryByText('This entry never sent')).not.toBeInTheDocument()
  })

  it('clears only the new entry slot when a new entry saves', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 1 } }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    await vi.waitFor(() => expect(sessionStorage.getItem('duels:entry:7')).toBeNull())
    expect(screen.queryByText('This entry never sent')).not.toBeInTheDocument()
  })

  // 6.6 puts a shortcut hint at --gray-10 because it is text a person reads. The
  // ramp is authored for dark surfaces, so on the primary button's white fill both
  // --gray-10 and the decoration-only --gray-9 fall under the 4.5:1 floor.
  it('paints the Save shortcut hint in a tone that is legal on white', () => {
    mount()
    const hint = within(saveButton()).getByText('Enter')
    expect(hint).toHaveClass('text-gray-7')
    expect(hint).not.toHaveClass('text-gray-9')
    expect(hint).not.toHaveClass('text-gray-10')
  })

  it('keeps every string a person reads off the decoration-only token', () => {
    mount()
    expect(screen.getByText('Match wins')).toHaveClass('text-gray-10')
    const results = screen.getByRole('region', { name: 'Results' })
    expect(results.innerHTML).not.toMatch(/text-gray-9/)
  })

  // 2.1 gives --white to text at 24px and below and --gray-12 to display type from
  // 24px up, because pure white halates at display size. The well is t8, 44px.
  it('sets the points wells in the near white, not pure white', () => {
    mount()
    for (const label of ['Ridgeline points', 'Lakeside points']) {
      expect(screen.getByLabelText(label)).toHaveClass('text-gray-12')
      expect(screen.getByLabelText(label)).not.toHaveClass('text-white')
    }
  })

  // The digit key only ever writes to the Ridgeline well, so only that well may
  // claim it.
  it('hints the digit shortcut on the one field it writes to', () => {
    mount()
    expect(screen.getAllByText('0 to 9')).toHaveLength(1)
    expect(screen.getByLabelText('Ridgeline points')).toHaveAttribute('aria-keyshortcuts', '0 1 2 3 4 5 6 7 8 9')
    expect(screen.getByLabelText('Lakeside points')).not.toHaveAttribute('aria-keyshortcuts')
  })

  /**
   * G33. The head carried the two team codes and the rows carried nothing, so a desk
   * scanning two hundred rows could only tell whose side a name was on by its column. The
   * plate is read off the competitor rather than off the column: nothing guarantees
   * athlete A is on team A, and a wrong colour is worse than none.
   */
  it('carries a team plate at each end of every ledger row', () => {
    mount()
    const row = screen.getByText('Mateo Rivera').closest('[data-side="a"]')?.parentElement as HTMLElement
    const sideA = row.querySelector('[data-side="a"]') as HTMLElement
    const sideB = row.querySelector('[data-side="b"]') as HTMLElement
    expect(within(sideA).getByText('RID')).toBeInTheDocument()
    expect(within(sideB).getByText('LAK')).toBeInTheDocument()
  })

  // 2.7: one set of tracks, so a score sits in the same register on every screen.
  it('lays the ledger out on the Ledger Grid tokens', () => {
    mount()
    const head = screen.getByText('Win by').parentElement as HTMLElement
    const row = screen.getByText('Mateo Rivera').closest('[data-side="a"]')?.parentElement as HTMLElement
    for (const el of [head, row]) {
      // Both scores and the timestamp, in one declaration shared by the head and
      // every row, so the head keeps lining up with its own digits.
      // 6.6 puts the win type in an 84px track, which is its own number and not the
      // points well's height.
      expect(el.className).toMatch(/var\(--col-num-s\)_84px_var\(--col-num-s\)/)
      expect(el.className).toMatch(/var\(--col-num-l\)/)
      expect(el.className).not.toMatch(/ch_\+_\d+px/)
    }
  })

  /**
   * xs is a 28px control in a 44px hit area. That is 4px taller than the 40px ledger rung,
   * so it would sit on top of the rows above and below, and 8px wider on each side than
   * the two adjacent 28px tracks can take: with a 12px gap between them the two hit areas
   * overlapped by 4px, and a press in that band landed on whichever of History and Edit
   * the DOM order gave it. Both reaches are clamped, so neither button reaches its
   * neighbour and neither reaches the next row.
   */
  it('keeps each ledger hit area inside its own row and off its neighbour', () => {
    mount()
    for (const name of ['Edit Mateo Rivera over Olivia Kim', 'History of Mateo Rivera over Olivia Kim']) {
      const button = screen.getByRole('button', { name })
      expect(button, name).toHaveClass('before:-top-1.5')
      expect(button, name).toHaveClass('before:-bottom-1.5')
      // The clamps sit alongside the size variant's own before:-inset-2 rather than
      // replacing it: inset-inline, top and bottom are all emitted after inset in the
      // stylesheet, so at equal specificity each of them wins on its own axis.
      expect(button, name).toHaveClass('before:-inset-x-1')
    }
  })

  // The At column was fed only by this session's own saves, so a reload or a second
  // desk device showed 40 blank cells for the rest of the event.
  it('shows the time of a result it did not save itself', () => {
    const reloaded: EventDetail = {
      ...detail,
      matches: [match(1, {
        status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points',
        endedAt: new Date(2026, 9, 3, 14, 7).toISOString(),
      })],
    }
    mount(reloaded)
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getByText('2:07')).toBeInTheDocument()
  })

  // G10. The tab means opposite things in the two modes, and only said so in one. A desk
  // volunteer typing a result a tablet has already recorded doubles the team score.
  describe('the note about who owns the results', () => {
    const snapshotIn = (mode: 'live' | 'entry'): Snapshot => {
      const s = sampleSnapshot()
      return { ...s, event: { ...s.event, id: 7, mode } }
    }

    // The stream outranks the stored row in both directions: another device can switch the
    // mode from a phone and nothing invalidates this laptop's copy of the event.
    it('warns that the mats own the results in a live event', () => {
      mount({ ...detail, event: { ...detail.event, mode: 'entry' } }, snapshotIn('live'))
      expect(screen.getByText(/^The mats own the results in this event\./)).toBeInTheDocument()
    })

    it('says nothing of the sort when the event runs from the desk', () => {
      mount(detail, snapshotIn('entry'))
      expect(screen.queryByText(/^The mats own the results/)).not.toBeInTheDocument()
    })

    // The stored mode is the fallback until the first snapshot lands.
    it('falls back to the stored mode before the first snapshot', () => {
      mount({ ...detail, event: { ...detail.event, mode: 'entry' } })
      expect(screen.queryByText(/^The mats own the results/)).not.toBeInTheDocument()
    })
  })

  // G15. Only the setup banner was conditional, so a finished event kept a live form and
  // a Save that the server now refuses.
  describe('once the event is finished', () => {
    const finishedDetail: EventDetail = {
      ...detail,
      event: { ...detail.event, status: 'done' },
      matches: [match(1, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' })],
    }

    it('takes the form and the save away and says why', () => {
      mount(finishedDetail)
      expect(screen.getByText(FINISHED_LINE)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Sav/ })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Ridgeline points')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Ridgeline competitor' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Finish event' })).not.toBeInTheDocument()
      // The record itself stays.
      const results = screen.getByRole('region', { name: 'Results' })
      expect(within(results).getByText('Mateo Rivera')).toBeInTheDocument()
    })

    // Ruling A: the server takes a correction of a settled match on a done event, so the
    // ledger keeps its Edit. The form is gone, so it opens the one correction dialog.
    it('keeps the ledger Edit and hands the result to the one correction dialog', async () => {
      mount(finishedDetail)
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /^Edit / }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Edit result')
      expect(within(dialog).getByLabelText('Ridgeline points')).toBeInTheDocument()
    })

    it('takes the ledger Edit away once the event is certified, and says so', () => {
      mount({ ...finishedDetail, event: { ...finishedDetail.event, status: 'certified' } })
      expect(screen.getByText(CERTIFIED_ENTRY_LINE)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Sav/ })).not.toBeInTheDocument()
    })

    // The trail is what certification protects, so reading it survives the lock.
    it('opens the match history from the ledger in both finished states', async () => {
      const f = fakeFetch(() => ({ json: [] }))
      mount({ ...finishedDetail, event: { ...finishedDetail.event, status: 'certified' } })
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /^History of / }))
      expect(await screen.findByRole('dialog')).toHaveTextContent(HISTORY_NOTE)
      expect(f.calls.some(c => c.url === '/api/matches/1/history')).toBe(true)
    })

    it('says the same words when the server refuses a write on a finished event', async () => {
      const f = fakeFetch(() => ({ status: 409, json: { error: { code: 'match_state', message: 'event is done' } } }))
      mount()
      const user = userEvent.setup()
      await pick(user, 'Ridgeline competitor', 'Ava Park')
      await pick(user, 'Lakeside competitor', 'Noah Tran')
      await user.type(screen.getByLabelText('Ridgeline points'), '5')
      await user.click(saveButton())
      await vi.waitFor(() => expect(f.calls.length).toBe(1))
      expect(await screen.findByText('This event is finished')).toBeInTheDocument()
      expect(screen.getByText('No result can be entered now, and the results here are the record.')).toBeInTheDocument()
      expect(screen.queryByText('This match already ended')).not.toBeInTheDocument()
    })

    it('maps a refused write on a certified event to the one sentence', async () => {
      const f = fakeFetch(() => ({ status: 409, json: { error: { code: 'match_state', message: 'event is certified' } } }))
      mount()
      const user = userEvent.setup()
      await pick(user, 'Ridgeline competitor', 'Ava Park')
      await pick(user, 'Lakeside competitor', 'Noah Tran')
      await user.type(screen.getByLabelText('Ridgeline points'), '5')
      await user.click(saveButton())
      await vi.waitFor(() => expect(f.calls.length).toBe(1))
      expect(await screen.findByText(CERTIFIED_REFUSAL_TITLE)).toBeInTheDocument()
      expect(screen.getByText(CERTIFIED_REFUSAL_BODY)).toBeInTheDocument()
    })
  })

  // G32. Finish lived only on the Live tab, which the desk never opens in entry mode.
  describe('finishing the event from the desk', () => {
    const liveDetail: EventDetail = {
      ...detail,
      event: { ...detail.event, status: 'live' },
      mats: [{ id: 11, eventId: 7, number: 1, currentMatchId: 2 }, { id: 12, eventId: 7, number: 2, currentMatchId: null }],
      matches: [
        match(1, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }),
        match(2, { athleteAId: 101, athleteBId: 201, status: 'live', matId: 11 }),
      ],
    }

    it('names every mat still on a match, then finishes', async () => {
      const f = fakeFetch(() => ({ json: null }))
      mount(liveDetail)
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Finish event' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Finish the event?')).toBeInTheDocument()
      expect(dialog).toHaveTextContent('Mat 1')
      expect(within(dialog).getByText('Ava Park vs Noah Tran')).toBeInTheDocument()
      expect(dialog).not.toHaveTextContent('Mat 2')
      // The sentence this replaces claimed a running match stays where it is, and a
      // finished event refuses every write.
      expect(within(dialog).queryByText(/stay where they are/)).not.toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: 'Finish event' }))
      await vi.waitFor(() => expect(f.calls.length).toBe(1))
      expect(f.calls[0].url).toBe('/api/events/7')
      expect(f.body(0)).toEqual({ status: 'done' })
    })

    it('leaves the event alone when the desk keeps scoring', async () => {
      const f = fakeFetch(() => ({ json: null }))
      mount(liveDetail)
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Finish event' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Keep scoring' }))
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(f.calls).toHaveLength(0)
    })

    it('does not offer Finish before the event has started', () => {
      mount()
      expect(screen.getByRole('button', { name: 'Start event' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Finish event' })).not.toBeInTheDocument()
    })
  })

  // G17. The id is held so a resend is deduped, which is right until the operator fixes
  // the payload and presses Save again: then the server replays the original result and
  // the client reports the corrected one. A 422 is the server saying it stored nothing.
  it('mints a new entryId for a retry the operator has corrected after a refusal', async () => {
    let broken = true
    const f = fakeFetch(() => broken
      ? { status: 422, json: { error: { code: 'validation', message: 'that pair is on the same team' } } }
      : { status: 201, json: { match: { id: 9 }, version: 3 } })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '6')
    await user.click(saveButton())
    await screen.findByText('That result cannot be saved')
    const first = f.body(0).entryId as string

    broken = false
    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '8')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(f.body(1)).toMatchObject({ pointsA: 8 })
    expect(f.body(1).entryId).not.toBe(first)
  })

  // C2. The watchdog fires while the POST is still in flight, so a write that landed
  // reads as a failure. Minting a new id for the corrected retry inserted a second done
  // match and the team's win was counted twice; keeping it makes the retry a replay, and
  // the desk is told what is on file.
  it('keeps the entryId through a timeout, even for a corrected retry', async () => {
    let hang = true
    const f = fakeFetch(() => hang
      ? new Promise<never>(() => {})
      : { status: 200, json: { match: { id: 9 }, version: 3 } })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '6')

    vi.useFakeTimers()
    try {
      fireEvent.click(saveButton())
      await act(async () => { vi.advanceTimersByTime(1) })
      await act(async () => { vi.advanceTimersByTime(8_100) })
      expect(screen.getByText('Could not reach the server')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
    const first = f.body(0).entryId as string

    hang = false
    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '8')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(f.body(1)).toMatchObject({ pointsA: 8 })
    expect(f.body(1).entryId).toBe(first)
  })

  // G29. The guard against typing the same pair twice lived only in memory, so the reload
  // a failed save invites reopened the window on the result the ledger already holds.
  it('asks about a repeated pair after a remount, from the ledger', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 3 } }))
    const recent: EventDetail = {
      ...detail,
      matches: [
        match(1, {
          status: 'done', athleteAId: 101, athleteBId: 201, pointsA: 4, pointsB: 2,
          winnerAthleteId: 101, winType: 'points', endedAt: new Date().toISOString(),
        }),
      ],
    }
    mount(recent)
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.click(saveButton())
    expect(await screen.findByText('These two were just entered')).toBeInTheDocument()
    expect(f.calls.filter(c => c.url === '/api/events/7/entries')).toHaveLength(0)
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.filter(c => c.url === '/api/events/7/entries')).toHaveLength(1))
  })

  it('keeps the entryId for a retry the operator has not touched', async () => {
    let broken = true
    const f = fakeFetch(() => broken
      ? { status: 500, json: { error: { code: 'internal', message: 'boom' } } }
      : { status: 201, json: { match: { id: 9 }, version: 3 } })
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '6')
    await user.click(saveButton())
    await screen.findByText('The server had a problem')
    const first = f.body(0).entryId as string

    broken = false
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(2))
    expect(f.body(1).entryId).toBe(first)
  })

  // A draft is only ever stored by a failed save, and the reload that rebuilt the form
  // forgot which kind of failure it was. Doubt is the safe reading: the id is kept, so a
  // corrected resend of a write that may already be on file comes back as a duplicate
  // rather than as a second win for the team.
  it('keeps the restored entryId when the payload changes after a reload', async () => {
    const f = fakeFetch(() => ({ status: 201, json: { match: { id: 9 }, version: 3 } }))
    saveDraft(7, { entryId: 'e-restored-0001', aId: '101', bId: '201', pointsA: '6', pointsB: '1', winner: 'a', winType: 'points', editingId: null })
    mount()
    const user = userEvent.setup()
    expect(screen.getByText('This entry never sent')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Ridgeline points'))
    await user.type(screen.getByLabelText('Ridgeline points'), '9')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    expect(f.body(0).entryId).toBe('e-restored-0001')
  })

  it('reads the confirmation off the response rather than off the form', async () => {
    const f = fakeFetch(() => ({
      status: 201,
      json: {
        match: {
          id: 9,
          a: { athleteId: 101, name: 'Ava Park', score: 5 },
          b: { athleteId: 201, name: 'Noah Tran', score: 2 },
          result: { winnerAthleteId: 101, winType: 'points' },
        },
        version: 3,
      },
    }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    expect(await screen.findByText('Saved. Ava Park beat Noah Tran on points, 5 to 2.')).toBeInTheDocument()
    expect(screen.queryByText('This entry was already saved')).not.toBeInTheDocument()
  })

  it('says a deduped save stored the earlier result, and names it', async () => {
    // 200 rather than 201: the server matched the id and returned the match it already had.
    const f = fakeFetch(() => ({
      status: 200,
      json: {
        match: {
          id: 9,
          a: { athleteId: 101, name: 'Ava Park', score: 6 },
          b: { athleteId: 201, name: 'Noah Tran', score: 1 },
          result: { winnerAthleteId: 101, winType: 'submission' },
        },
        version: 3,
      },
    }))
    mount()
    const user = userEvent.setup()
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2')
    await user.click(saveButton())
    await vi.waitFor(() => expect(f.calls.length).toBe(1))
    expect(await screen.findByText('This entry was already saved')).toBeInTheDocument()
    expect(screen.getByText(/The result on file is Ava Park beat Noah Tran by submission, 6 to 1\./)).toBeInTheDocument()
    expect(screen.getByText('Already saved. Ava Park beat Noah Tran by submission, 6 to 1.')).toBeInTheDocument()
  })

  // G14. The eight second deadline is written for the POST. It used to cover the POST
  // plus the refetch the mutation ran on success, so a save that landed in a second and
  // a refetch that took nine reported a saved result as a network failure.
  it('confirms a slow success from the post alone', async () => {
    let matches = detail.matches
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
    let gets = 0
    const f = fakeFetch(async url => {
      if (url === '/api/events/7') {
        gets += 1
        if (gets > 1) await wait(9_000)
        return { json: { ...detail, matches } }
      }
      if (url === '/api/events/7/entries') {
        await wait(1_000)
        matches = [...matches, match(9, {
          status: 'done', athleteAId: 101, athleteBId: 201, pointsA: 5, pointsB: 2,
          winnerAthleteId: 101, winType: 'points', endedAt: new Date(2026, 9, 3, 14, 22).toISOString(),
        })]
        return { status: 201, json: { match: { id: 9 }, version: 2 } }
      }
      return { json: null }
    })
    mountLive()
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Results' })
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2')

    vi.useFakeTimers()
    try {
      fireEvent.click(saveButton())
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(saveButton()).toHaveTextContent('Saved')

      // Past the deadline, with the refetch still out.
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(f.calls.filter(c => c.url === '/api/events/7/entries')).toHaveLength(1)

      // And the refetch still lands, behind the confirmation rather than inside it.
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      const results = screen.getByRole('region', { name: 'Results' })
      expect(within(results).getByRole('button', { name: 'Edit Ava Park over Noah Tran' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // G13. The ledger sorted by id, so a result typed against a match the designer had
  // already laid out landed mid list under a head that says newest first, and the
  // arrival highlight fired off screen.
  it('puts the newest finish at the top even when its match id is the lower one', () => {
    const ordered: EventDetail = {
      ...detail,
      matches: [
        match(5, {
          status: 'done', athleteAId: 100, athleteBId: 200, pointsA: 3, pointsB: 1, winnerAthleteId: 100,
          winType: 'points', endedAt: new Date(2026, 9, 3, 14, 5).toISOString(),
        }),
        match(2, {
          status: 'done', athleteAId: 101, athleteBId: 201, pointsA: 6, pointsB: 0, winnerAthleteId: 101,
          winType: 'points', endedAt: new Date(2026, 9, 3, 14, 40).toISOString(),
        }),
      ],
    }
    mount(ordered)
    const results = screen.getByRole('region', { name: 'Results' })
    const rows = within(results).getAllByRole('button', { name: /^Edit/ }).map(b => b.getAttribute('aria-label'))
    expect(rows).toEqual(['Edit Ava Park over Noah Tran', 'Edit Mateo Rivera over Olivia Kim'])
  })

  // G12. The save parks focus on the first field for the next entry, and 4.4 counts a
  // focused field as an operator gesture, so the refetch carrying the row the operator
  // just saved was held behind the confirmation it exists to be.
  it('lands the saved row and the new running score with focus where the save left it', async () => {
    let matches = detail.matches
    const f = fakeFetch(url => {
      if (url === '/api/events/7') return { json: { ...detail, matches } }
      if (url === '/api/events/7/entries') {
        matches = [...matches, match(9, {
          status: 'done', athleteAId: 101, athleteBId: 201, pointsA: 5, pointsB: 2,
          winnerAthleteId: 101, winType: 'points', endedAt: new Date(2026, 9, 3, 14, 22).toISOString(),
        })]
        return { status: 201, json: { match: { id: 9 }, version: 2 } }
      }
      return { json: null }
    })
    mountLive()
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Results' })
    await pick(user, 'Ridgeline competitor', 'Ava Park')
    await pick(user, 'Lakeside competitor', 'Noah Tran')
    await user.type(screen.getByLabelText('Ridgeline points'), '5')
    await user.type(screen.getByLabelText('Lakeside points'), '2{Enter}')
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/entries')).toBe(true))

    // Where the app itself put focus, and the operator has touched nothing since.
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Ridgeline competitor' })).toHaveFocus())
    const results = screen.getByRole('region', { name: 'Results' })
    await vi.waitFor(() => expect(within(results).getByRole('button', { name: 'Edit Ava Park over Noah Tran' })).toBeInTheDocument())
    const score = screen.getByRole('region', { name: 'Running team score' })
    await vi.waitFor(() => expect(within(score).getByText('2')).toBeInTheDocument())
  })
})

// I5: a Finish pressed on a second device reaches this form through the stream, and the
// detail is a cache that nothing invalidates; a form left up over a finished event is a
// form that still says Save.
describe('EntryTab reads the event status off the stream', () => {
  it('shows the done state when the room says finished and the cache still says live', () => {
    const view = sampleSnapshot()
    mount(detail, { ...view, event: { ...view.event, status: 'done' } })
    expect(screen.queryByRole('button', { name: /^Sav/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finish event' })).not.toBeInTheDocument()
    expect(screen.getByText(/This event is finished/)).toBeInTheDocument()
  })
})
