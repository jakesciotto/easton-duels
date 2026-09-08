import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuditEntry } from '@shared/types'
import { HISTORY_EMPTY, HISTORY_NOTE, MatchHistorySheet } from '@/routes/event/MatchHistorySheet'
import type { HistorySource } from '@/routes/event/match-history'
import { setAdminToken } from '@/lib/auth'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const at = (h: number, m: number, s: number) => new Date(2026, 9, 3, h, m, s).toISOString()

const source: HistorySource = {
  path: '/api/matches/9/history',
  title: 'Mat 2, Mateo Rivera vs Olivia Kim',
  context: {
    nameOf: id => (id === 100 ? 'Mateo Rivera' : 'Olivia Kim'),
    athleteAId: 100,
    athleteBId: 200,
    actions: [{ key: 'takedown', label: 'Takedown', points: 2 }],
    terminals: [{ key: 'submission', label: 'Submission', winType: 'submission' }],
  },
}

const log: AuditEntry[] = [
  { id: 1, at: at(15, 41, 2), actor: 'mat:2', action: 'clock_start', detail: { seq: 1 } },
  { id: 2, at: at(15, 41, 38), actor: 'mat:2', action: 'score', detail: { seq: 2, athleteId: 100, actionKey: 'takedown' } },
  { id: 3, at: at(16, 2, 19), actor: 'admin', action: 'correction', detail: {
    before: { pointsA: 2, pointsB: 0, winnerAthleteId: 200, winType: 'points' },
    after: { pointsA: 2, pointsB: 0, winnerAthleteId: 200, winType: 'submission' },
    reason: 'referee called the tap',
  } },
]

function mount(s: HistorySource | null = source) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MatchHistorySheet source={s} open={s !== null} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('MatchHistorySheet', () => {
  it('reads the match log and prints time, who and what changed', async () => {
    const f = fakeFetch(() => ({ json: log }))
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Mat 2, Mateo Rivera vs Olivia Kim')).toBeInTheDocument()
    expect(within(dialog).getByText(HISTORY_NOTE)).toBeInTheDocument()
    expect(await within(dialog).findByText('Clock started')).toBeInTheDocument()
    expect(within(dialog).getByText('3:41:02')).toBeInTheDocument()
    expect(within(dialog).getAllByText('mat 2')).toHaveLength(2)
    expect(within(dialog).getByText('Takedown +2 Mateo Rivera')).toBeInTheDocument()
    expect(within(dialog).getByText('Score 2 to 0')).toBeInTheDocument()
    expect(within(dialog).getByText(/Reason: referee called the tap/)).toBeInTheDocument()
    expect(f.calls[0].url).toBe('/api/matches/9/history')
  })

  it('holds skeleton rows sized to the content while the log is in flight', async () => {
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    fakeFetch(async () => {
      await held
      return { json: log }
    })
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    release()
    expect(await within(dialog).findByText('Clock started')).toBeInTheDocument()
    expect(dialog.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
  })

  it('states a failure rather than an empty list', async () => {
    fakeFetch(() => ({ status: 500, json: { error: { code: 'server', message: 'the log did not come back' } } }))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('The history did not load')
    expect(screen.getByRole('alert')).toHaveTextContent('the log did not come back')
  })

  it('says a log with nothing in it is empty, in words', async () => {
    fakeFetch(() => ({ json: [] }))
    mount()
    expect(await screen.findByText(HISTORY_EMPTY)).toBeInTheDocument()
  })

  it('renders nothing at all without a source', () => {
    fakeFetch(() => ({ json: [] }))
    mount(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // The log only grows, and somebody opening it a second time is doing so because
  // something has happened since.
  it('reads again on every open rather than caching the first answer', async () => {
    const f = fakeFetch(() => ({ json: log }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <MatchHistorySheet source={source} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    await screen.findByText('Clock started')
    rerender(
      <QueryClientProvider client={qc}>
        <MatchHistorySheet source={source} open={false} onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    rerender(
      <QueryClientProvider client={qc}>
        <MatchHistorySheet source={source} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(f.calls.filter(c => c.url === '/api/matches/9/history')).toHaveLength(2))
  })
})
