import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddMatchDialog } from '@/routes/event/AddMatchDialog'
import { setAdminToken } from '@/lib/auth'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number, first: string, last: string): AthleteRow => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 62, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
})

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', mode: 'live', status: 'setup', sameGender: false, createdAt: 'x' },
  teams: [
    { id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 },
    { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 },
    { id: 3, eventId: 7, name: 'Fernwood', color: 'teal', position: 2 },
  ],
  athletes: [
    kid(100, 1, 'Mateo', 'Rivera'), kid(101, 1, 'Ava', 'Park'),
    kid(200, 2, 'Olivia', 'Kim'), kid(300, 3, 'Iris', 'Nolan'),
  ],
  rulesets: [{ id: 1, eventId: 7, name: 'Kids gi', defaultLengthSec: 300, actions: [], terminals: [] }],
  mats: [{ id: 11, eventId: 7, number: 1, currentMatchId: null }, { id: 12, eventId: 7, number: 2, currentMatchId: null }],
  matches: [], candidateCount: 0,
}

function mount(opts: { start?: number; onOpenChange?: (o: boolean) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AddMatchDialog detail={detail} start={opts.start ?? null} open onOpenChange={opts.onOpenChange ?? (() => {})} />
    </QueryClientProvider>,
  )
}

async function pick(dialog: HTMLElement, trigger: string, option: RegExp) {
  const user = userEvent.setup()
  await user.click(within(dialog).getByRole('combobox', { name: trigger }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('AddMatchDialog', () => {
  it('defaults the mat to least loaded and takes the pick on the one Toggle primitive', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const dialog = await screen.findByRole('dialog')
    const mats = within(dialog).getByRole('group', { name: 'Mat' })
    expect(within(mats).getByRole('button', { name: 'Least loaded' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.setup().click(within(mats).getByRole('button', { name: 'Mat 2' }))
    expect(within(mats).getByRole('button', { name: 'Mat 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(mats).getByRole('button', { name: 'Least loaded' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('carries the ruleset length as m:ss and posts it as seconds', async () => {
    const f = fakeFetch(() => ({ status: 201, json: {} }))
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Length (m:ss)')).toHaveValue('5:00')
    await pick(dialog, 'First competitor', /Mateo Rivera/)
    await pick(dialog, 'Second competitor', /Olivia Kim/)
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Add match' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.init?.method === 'POST')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.init?.method === 'POST'))).toEqual({
      athleteAId: 100, athleteBId: 200, rulesetId: 1, lengthSec: 300,
    })
  })

  it('will not add a match with a slot still empty', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Add match' })).toBeDisabled()
  })

  // A match pairs two teams, so picking a competitor takes that whole team out of the
  // other slot rather than letting an organizer build a pairing the server refuses.
  it('keeps the second slot to the teams the first one is not on', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    await pick(dialog, 'First competitor', /Mateo Rivera/)
    await user.click(within(dialog).getByRole('combobox', { name: 'Second competitor' }))
    expect(await screen.findByRole('option', { name: /Olivia Kim/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Iris Nolan/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Ava Park/ })).not.toBeInTheDocument()
  })

  it('opens on the competitor the caller named', async () => {
    fakeFetch(() => ({ json: {} }))
    mount({ start: 300 })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('First competitor')).toHaveTextContent('Iris Nolan')
  })

  // 8: a hand designed pair never blocks. The server takes it and says what it noticed,
  // and the dialog stays up to report that rather than closing over it.
  it('stays open and prints the warnings the server sent back', async () => {
    fakeFetch(() => ({ status: 201, json: { warnings: ['4 weight classes apart', 'Already met'] } }))
    const onOpenChange = vi.fn()
    mount({ onOpenChange })
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    await pick(dialog, 'First competitor', /Mateo Rivera/)
    await pick(dialog, 'Second competitor', /Olivia Kim/)
    await user.click(within(dialog).getByRole('button', { name: 'Add match' }))
    expect(await within(dialog).findByText('4 weight classes apart')).toBeInTheDocument()
    expect(within(dialog).getByText('Already met')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes on a pairing the server had nothing to say about', async () => {
    fakeFetch(() => ({ status: 201, json: { warnings: [] } }))
    const onOpenChange = vi.fn()
    mount({ onOpenChange })
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    await pick(dialog, 'First competitor', /Mateo Rivera/)
    await pick(dialog, 'Second competitor', /Olivia Kim/)
    await user.click(within(dialog).getByRole('button', { name: 'Add match' }))
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
