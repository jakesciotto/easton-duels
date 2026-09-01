import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RulesetsTab } from '@/routes/event/RulesetsTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [], athletes: [], mats: [], matches: [], candidateCount: 0,
  rulesets: [{ id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300, actions: [{ key: 'takedown', label: 'Takedown', points: 2 }], terminals: [{ key: 'pin', label: 'Pin', winType: 'submission' }] }],
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RulesetsTab detail={detail} /></QueryClientProvider>)
}

describe('RulesetsTab', () => {
  it('lists rulesets and creates one from the dialog', async () => {
    const f = fakeFetch(() => ({ status: 201, json: {} }))
    mount()
    expect(screen.getByText('Default')).toBeInTheDocument()
    // 6.7: action points are a column of values (word + right-aligned mono value), not a
    // Badge -- the label and its signed value are separate reads on one ledger row.
    expect(screen.getByText('Takedown')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('Pin')).toBeInTheDocument()
    expect(screen.getByText('submission')).toBeInTheDocument()
    // The default clock length renders in the same M:SS mono form the board uses.
    expect(screen.getByText('5:00')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New ruleset' }))
    await user.type(screen.getByLabelText('Name'), 'Wrestling')
    // The length is typed in the same m:ss form the board and the mat clock print,
    // so the number the ruleset sets and the number the room reads are one object.
    await user.clear(screen.getByLabelText('Default length (m:ss)'))
    await user.type(screen.getByLabelText('Default length (m:ss)'), '3:00')
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    const labels = screen.getAllByLabelText('Action label')
    await user.type(labels[labels.length - 1], 'Near fall')
    const points = screen.getAllByLabelText('Action points')
    await user.clear(points[points.length - 1])
    await user.type(points[points.length - 1], '3')
    await user.click(screen.getByRole('button', { name: 'Save ruleset' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/events/7/rulesets')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/events/7/rulesets'))
    expect(body.name).toBe('Wrestling')
    expect(body.defaultLengthSec).toBe(180)
    expect(body.actions.at(-1)).toEqual({ key: 'near_fall', label: 'Near fall', points: 3 })
  })
})
