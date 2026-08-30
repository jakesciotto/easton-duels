import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LiveTab } from '@/routes/event/LiveTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch, FakeEventSource, sampleMatch, sampleSnapshot } from './fakes'

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }))
beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

const detail: EventDetail = {
  event: { id: 1, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 1, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 1, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [{ id: 1, eventId: 1, number: 1, currentMatchId: 10 }], matches: [],
}

function mount() {
  vi.stubGlobal('EventSource', FakeEventSource)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><LiveTab detail={detail} /></MemoryRouter></QueryClientProvider>)
  return FakeEventSource.instances[0]
}

describe('LiveTab', () => {
  it('shows connect info, mat status from the stream, and posts a reopen', async () => {
    const f = fakeFetch(url => url.endsWith('/connect') ? { json: { url: 'http://192.168.1.20:8422', matCode: '0420' } } : { json: { match: {}, version: 3 } })
    const es = mount()
    expect(await screen.findByText('0420')).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.20:8422')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'QR code' })).toHaveAttribute('src', expect.stringContaining('data:image/png'))
    const done = sampleMatch({ id: 9, status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: sampleMatch({ id: 10 }), onDeck: [], bound: true }], matches: [done, sampleMatch({ id: 10 })] })))
    const row = screen.getByRole('row', { name: /Mat 1/ })
    expect(within(row).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(row).getByText('scorer connected')).toBeInTheDocument()
    const doneRow = screen.getByRole('row', { name: /Match 1/ })
    await userEvent.setup().click(within(doneRow).getByRole('button', { name: 'Reopen' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/9/reopen')).toBe(true))
  })
})
