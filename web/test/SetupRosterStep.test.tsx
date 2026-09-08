import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SetupRosterStep } from '@/routes/event/SetupRosterStep'
import { setAdminToken } from '@/lib/auth'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const kid = (id: number, teamId: number | null, first: string, last: string, belt: string | null, age: number | null): AthleteRow => ({
  id, eventId: 7, teamId, firstName: first, lastName: last, age, ageSource: 'manual', weightLbs: 60, weightSource: 'manual',
  belt, gender: 'M', source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
})

const ROSTER = [
  kid(100, 1, 'Mateo', 'Alvarez', 'grey', 9),
  kid(101, 2, 'Olivia', 'Brandt', 'grey-white', 9),
  kid(102, 1, 'Kai', 'Castellano', 'yellow', 10),
  kid(103, 2, 'Ava', 'Delgado', 'grey', 8),
]

function detailWith(athletes: AthleteRow[], candidateCount = 0): EventDetail {
  return {
    event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', status: 'setup', mode: 'live', sameGender: false, createdAt: 'x' },
    teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
    athletes,
    rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [], terminals: [] }],
    mats: [{ id: 1, eventId: 7, number: 1, currentMatchId: null }, { id: 2, eventId: 7, number: 2, currentMatchId: null }],
    matches: [],
    candidateCount,
  }
}

function mount(detail: EventDetail, over: { onClose?: () => void; onContinue?: () => void } = {}) {
  fakeFetch(url => (url.endsWith('/wl-locations') ? { json: [] } : { json: {} }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <SetupRosterStep detail={detail} open onClose={over.onClose ?? (() => {})} onContinue={over.onContinue ?? (() => {})} />
    </QueryClientProvider>,
  )
}

describe('SetupRosterStep', () => {
  it('counts the roster and shows the first three, with the rest named as a place to go', async () => {
    mount(detailWith(ROSTER))
    await screen.findByText('Who is competing?')
    expect(screen.getByText('competitors so far').previousElementSibling).toHaveTextContent('4')
    expect(screen.getByText('Mateo Alvarez')).toBeInTheDocument()
    expect(screen.getByText('Grey, 9')).toBeInTheDocument()
    expect(screen.getByText('Kai Castellano')).toBeInTheDocument()
    // The fourth is not drawn: the step says where it is instead of becoming the tab.
    expect(screen.queryByText('Ava Delgado')).not.toBeInTheDocument()
    expect(screen.getByText('and 1 more on the Roster tab')).toBeInTheDocument()
  })

  it('marks itself step two of three', async () => {
    mount(detailWith(ROSTER))
    await screen.findByText('Who is competing?')
    expect(screen.getByText('2 Roster')).toHaveAttribute('aria-current', 'step')
  })

  // A duel needs two sides, so the step that leads to the matchmaker will not hand it one
  // competitor and let the next screen fail.
  it('refuses Continue until two competitors are in', async () => {
    mount(detailWith(ROSTER.slice(0, 1)))
    await screen.findByText('Who is competing?')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('allows Continue at two, and reports it', async () => {
    const onContinue = vi.fn()
    mount(detailWith(ROSTER.slice(0, 2)), { onContinue })
    const user = userEvent.setup()
    await screen.findByText('Who is competing?')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalled()
  })

  it('has nothing to list before anybody is on the roster', async () => {
    mount(detailWith([]))
    await screen.findByText('Who is competing?')
    expect(screen.getByText('competitors so far').previousElementSibling).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  // The two ways in are the dialogs the Roster tab already owns. The step hands over to one
  // of them and takes the screen back when it closes, so the count is read where it was
  // asked for rather than on a tab.
  it('opens the WellnessLiving import as a sub step and comes back', async () => {
    mount(detailWith([]))
    const user = userEvent.setup()
    await screen.findByText('Who is competing?')
    await user.click(screen.getByRole('button', { name: /Import from WellnessLiving/ }))
    expect(await screen.findByText('Sync roster from WellnessLiving')).toBeInTheDocument()
    expect(screen.queryByText('Who is competing?')).not.toBeInTheDocument()

    // The header's X carries the same name, and the footer's is the one the operator reads.
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement)
    expect(await screen.findByText('Who is competing?')).toBeInTheDocument()
    expect(screen.queryByText('Sync roster from WellnessLiving')).not.toBeInTheDocument()
  })

  it('opens the paste dialog as a sub step and comes back', async () => {
    mount(detailWith([]))
    const user = userEvent.setup()
    await screen.findByText('Who is competing?')
    await user.click(screen.getByRole('button', { name: /Paste a roster/ }))
    expect(await screen.findByText('Paste roster')).toBeInTheDocument()
    expect(screen.queryByText('Who is competing?')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Who is competing?')).toBeInTheDocument()
  })

  // The Roster tab hides its own sync button once a pool is cached, because Add competitor
  // sits beside it and reaches the pool. The step has no such neighbour, so taking the card
  // away would leave a pull that added nobody with no way back to what it pulled.
  it('keeps the WellnessLiving card once the event holds a candidate pool', async () => {
    mount(detailWith(ROSTER, 630))
    await screen.findByText('Who is competing?')
    expect(screen.getByRole('button', { name: /Import from WellnessLiving/ })).toBeInTheDocument()
  })

  it('closes the step on Skip for now', async () => {
    const onClose = vi.fn()
    mount(detailWith(ROSTER), { onClose })
    const user = userEvent.setup()
    await screen.findByText('Who is competing?')
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onClose).toHaveBeenCalled()
  })
})
