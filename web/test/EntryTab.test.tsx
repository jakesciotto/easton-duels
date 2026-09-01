import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EntryTab } from '@/routes/event/EntryTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow } from '@/lib/types'
import { fakeFetch } from './fakes'

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
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'), kid(200, 2, 'Olivia', 'Kim'), kid(201, 2, 'Noah', 'Tran')],
  rulesets: [], mats: [],
  matches: [match(1, { status: 'done', pointsA: 4, pointsB: 2, winnerAthleteId: 100, winType: 'points' }), match(2, { athleteAId: 101, athleteBId: 201 })],
  candidateCount: 0,
}

function mount(d: EventDetail = detail) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><EntryTab detail={d} /></QueryClientProvider>)
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

  // 2.7: one set of tracks, so a score sits in the same register on every screen.
  it('lays the ledger out on the Ledger Grid tokens', () => {
    mount()
    const head = screen.getByText('Win by').parentElement as HTMLElement
    const row = screen.getByText('Mateo Rivera').closest('[data-side="a"]')?.parentElement as HTMLElement
    for (const el of [head, row]) {
      // Both scores and the timestamp, in one declaration shared by the head and
      // every row, so the head keeps lining up with its own digits.
      expect(el.className).toMatch(/var\(--col-num-s\)_88px_var\(--col-num-s\)/)
      expect(el.className).toMatch(/var\(--col-num-l\)/)
      expect(el.className).not.toMatch(/ch_\+_\d+px/)
    }
  })

  // xs is a 28px control in a 44px hit area, which is 4px taller than the 40px
  // ledger rung and would sit on top of the rows above and below.
  it('keeps the ledger edit hit area inside its own row', () => {
    mount()
    const edit = screen.getByRole('button', { name: 'Edit Mateo Rivera over Olivia Kim' })
    expect(edit).toHaveClass('before:-top-1.5')
    expect(edit).toHaveClass('before:-bottom-1.5')
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
})
