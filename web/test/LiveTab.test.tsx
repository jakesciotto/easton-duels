import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LiveTab } from '@/routes/event/LiveTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch, FakeEventSource, sampleMatch, sampleSnapshot } from './fakes'

vi.mock('qrcode', () => ({ default: { toString: async () => '<svg>mock</svg>' } }))
beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.instances = [] })

const detail: EventDetail = {
  event: { id: 1, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 1, name: 'Boulder', color: 'red', position: 0 }, { id: 2, eventId: 1, name: 'Denver', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [{ id: 1, eventId: 1, number: 1, currentMatchId: 10 }], matches: [],
}

const done = sampleMatch({ id: 9, orderIndex: 0, status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })
const live = sampleMatch({ id: 10, orderIndex: 1 })
const played = sampleSnapshot({ mats: [{ id: 1, number: 1, current: live, onDeck: [], bound: true }], matches: [done, live] })

function mount(d: EventDetail = detail) {
  vi.stubGlobal('EventSource', FakeEventSource)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><LiveTab detail={d} /></MemoryRouter></QueryClientProvider>)
  return FakeEventSource.instances[0]
}

const connectOnly = (url: string) => (url.endsWith('/connect') ? { json: { url: 'http://192.168.1.20:8422', matCode: '0420' } } : { json: {} })

describe('LiveTab', () => {
  it('shows connect info, mat status from the stream, and posts a reopen', async () => {
    const f = fakeFetch(url => url.endsWith('/connect') ? { json: { url: 'http://192.168.1.20:8422', matCode: '0420' } } : { json: { match: {}, version: 3 } })
    const es = mount()
    expect(await screen.findByText('0420')).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.20:8422')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'QR code' })).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'))
    act(() => es.emit('snapshot', played))
    const row = screen.getByRole('row', { name: /Mat 1/ })
    expect(within(row).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(row).getByText('scorer connected')).toBeInTheDocument()
    const doneRow = screen.getByRole('row', { name: /Match 1/ })
    await userEvent.setup().click(within(doneRow).getByRole('button', { name: 'Reopen' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/9/reopen')).toBe(true))
  })

  it('numbers matches by the running order, not by their place in the table', () => {
    fakeFetch(connectOnly)
    const es = mount()
    // The pending first match is filtered out of the table, so the second match must still
    // read as 2, the number the board and the scorer show for it.
    const pending = sampleMatch({ id: 8, orderIndex: 0, status: 'pending' })
    const second = sampleMatch({ id: 9, orderIndex: 1, status: 'done', result: { winnerAthleteId: 100, winType: 'points' } })
    act(() => es.emit('snapshot', sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }], matches: [pending, second] })))
    expect(screen.getByRole('row', { name: /Match 2/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Match 1/ })).not.toBeInTheDocument()
  })

  it('skips the match on a mat', async () => {
    const f = fakeFetch(connectOnly)
    const es = mount()
    act(() => es.emit('snapshot', played))
    await userEvent.setup().click(within(screen.getByRole('row', { name: /Mat 1/ })).getByRole('button', { name: 'Skip' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/10/skip' && c.init?.method === 'POST')).toBe(true))
  })

  it('shows the server message when an override is refused', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/matches/10/skip' && init?.method === 'POST') {
        return { status: 409, json: { error: { code: 'match_state', message: 'match is not live' } } }
      }
      return connectOnly(url)
    })
    const es = mount()
    act(() => es.emit('snapshot', played))
    await userEvent.setup().click(within(screen.getByRole('row', { name: /Mat 1/ })).getByRole('button', { name: 'Skip' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('match is not live')
  })

  it('edits a finished result with the picked winner', async () => {
    const f = fakeFetch(connectOnly)
    const es = mount()
    act(() => es.emit('snapshot', played))
    const user = userEvent.setup()
    await user.click(within(screen.getByRole('row', { name: /Match 1/ })).getByRole('button', { name: 'Edit result' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Olivia Kim wins/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save result' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/matches/9/result')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/matches/9/result'))).toEqual({ winnerAthleteId: 200, winType: 'points' })
  })

  it('starts the event', async () => {
    const f = fakeFetch(connectOnly)
    mount({ ...detail, event: { ...detail.event, status: 'setup' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start event' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/1' && c.init?.method === 'PATCH')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/events/1' && c.init?.method === 'PATCH'))).toEqual({ status: 'live' })
  })

  it('finishes the event only after the confirm dialog', async () => {
    const f = fakeFetch(connectOnly)
    mount()
    const user = userEvent.setup()
    const patches = () => f.calls.filter(c => c.url === '/api/events/1' && c.init?.method === 'PATCH')
    await user.click(screen.getByRole('button', { name: 'Finish event' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Finish the event?')).toBeInTheDocument()
    expect(patches()).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Finish event' }))
    await vi.waitFor(() => expect(patches()).toHaveLength(1))
    expect(JSON.parse(String(patches()[0].init?.body))).toEqual({ status: 'done' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the finish dialog open when the server refuses', async () => {
    fakeFetch((url, init) => {
      if (url === '/api/events/1' && init?.method === 'PATCH') {
        return { status: 409, json: { error: { code: 'match_state', message: 'only a live event can finish' } } }
      }
      return connectOnly(url)
    })
    mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Finish event' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Finish event' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('only a live event can finish')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
