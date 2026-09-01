import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KidPickerDialog } from '@/routes/event/KidPickerDialog'
import type { AthleteRow, EventDetail, MatchRow } from '@/lib/types'

const kid = (id: number, first: string, last: string, over: Partial<AthleteRow> = {}): AthleteRow => ({
  id, eventId: 7, teamId: 1, firstName: first, lastName: last, age: 8, ageSource: 'manual', weightLbs: 62, weightSource: 'manual',
  belt: 'grey', gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null, ...over,
})

const match: MatchRow = {
  id: 1, eventId: 7, matId: null, orderIndex: 0, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200,
  status: 'pending', winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
}

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', mode: 'live', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }],
  athletes: [kid(100, 'Mateo', 'Rivera', { erp: 6.1 }), kid(101, 'Liam', 'Cruz', { age: null })],
  rulesets: [], mats: [], matches: [match], candidateCount: 0,
}

function mount(onPick = vi.fn()) {
  render(<KidPickerDialog detail={detail} teamId={1} matchId={1} open onOpenChange={() => {}} onPick={onPick} />)
  return onPick
}

describe('KidPickerDialog', () => {
  it('marks the competitor already in the slot as pressed', async () => {
    mount()
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: 'Mateo Rivera' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Liam Cruz' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('picks on one press, because a swap is a hot path', async () => {
    const onPick = mount()
    await screen.findByRole('dialog')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Liam Cruz' }))
    expect(onPick).toHaveBeenCalledWith(101)
  })

  it('marks a missing age in its own track rather than at a different x on every row', async () => {
    mount()
    const row = await screen.findByRole('button', { name: 'Liam Cruz' })
    expect(row).toHaveTextContent('--')
  })

  it('offers a way out of an empty search', async () => {
    mount()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Search competitors'), 'zzz')
    expect(screen.getByText('No competitors match. Clear the search.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('button', { name: 'Mateo Rivera' })).toBeInTheDocument()
  })
})
