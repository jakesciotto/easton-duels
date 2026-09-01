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
})

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', mode: 'live', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [kid(100, 1, 'Mateo', 'Rivera'), kid(200, 2, 'Olivia', 'Kim')],
  rulesets: [{ id: 1, eventId: 7, name: 'Kids gi', defaultLengthSec: 300, actions: [], terminals: [] }],
  mats: [{ id: 11, eventId: 7, number: 1, currentMatchId: null }, { id: 12, eventId: 7, number: 2, currentMatchId: null }],
  matches: [], candidateCount: 0,
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><AddMatchDialog detail={detail} open onOpenChange={() => {}} /></QueryClientProvider>)
}

async function pick(dialog: HTMLElement, trigger: string, option: string) {
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
    await pick(dialog, 'Ridgeline competitor', 'Mateo Rivera')
    await pick(dialog, 'Lakeside competitor', 'Olivia Kim')
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
})
