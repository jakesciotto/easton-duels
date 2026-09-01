import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ResultDialog } from '@/routes/event/ResultDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch, sampleMatch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', mode: 'live', status: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [{ id: 1, eventId: 7, number: 2, currentMatchId: null }], matches: [], candidateCount: 0,
}

// Built from a local Date so the printed time is the same wherever the suite runs.
const endedAt = new Date(2026, 9, 3, 15, 41).toISOString()
const done = sampleMatch({
  id: 9, orderIndex: 11, matId: 1, status: 'done', endedAt,
  a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: 'grey', weightLbs: 62, score: 9 },
  b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: 'grey', weightLbs: 60, score: 2 },
  result: { winnerAthleteId: 100, winType: 'points' },
})

function mount(match = done) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><ResultDialog detail={detail} match={match} open onOpenChange={() => {}} /></QueryClientProvider>)
}

describe('ResultDialog', () => {
  it('states the original result as one sentence naming match, mat, time, score and win type', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Match 12, mat 2, ended 3:41 pm, 9 to 2, Mateo Rivera on points.')).toBeInTheDocument()
  })

  it('holds that sentence still while a newer snapshot of the same match arrives', async () => {
    fakeFetch(() => ({ json: {} }))
    const { rerender } = mount()
    await screen.findByRole('dialog')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const moved = { ...done, a: { ...done.a, score: 4 }, result: { winnerAthleteId: 200, winType: 'submission' as const } }
    rerender(<QueryClientProvider client={qc}><ResultDialog detail={detail} match={moved} open onOpenChange={() => {}} /></QueryClientProvider>)
    expect(screen.getByText(/9 to 2, Mateo Rivera on points/)).toBeInTheDocument()
  })

  it('writes the correction as an entry, so the scores are part of it', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    // Both wells start from the recorded score, which is what a correction is against.
    expect(within(dialog).getByLabelText('Ridgeline points')).toHaveValue('9')
    await user.clear(within(dialog).getByLabelText('Lakeside points'))
    await user.type(within(dialog).getByLabelText('Lakeside points'), '11')
    await user.click(within(dialog).getByRole('button', { name: /Olivia Kim wins/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/9/entry')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/matches/9/entry'))
    expect(body).toMatchObject({ pointsA: 9, pointsB: 11, winnerAthleteId: 200, winType: 'points' })
    expect(String(body.entryId).length).toBeGreaterThan(7)
  })

  it('refuses a save with no winner marked', async () => {
    fakeFetch(() => ({ json: {} }))
    mount(sampleMatch({ id: 9, orderIndex: 0, matId: null, status: 'live', result: null }))
    expect(await screen.findByRole('button', { name: 'Save result' })).toBeDisabled()
    expect(screen.getByText(/no mat, 0 to 0, no result recorded/)).toBeInTheDocument()
  })
})
