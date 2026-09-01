import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RulesetDialog } from '@/routes/event/RulesetDialog'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow, RulesetRow } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

const ruleset: RulesetRow = {
  id: 3, eventId: 7, name: 'Kids gi', defaultLengthSec: 300,
  actions: [{ key: 'takedown', label: 'Takedown', points: 2 }, { key: 'penalty', label: 'Penalty', points: -1 }],
  terminals: [{ key: 'submission', label: 'Submission', winType: 'submission' }],
}

const match = (id: number, status: MatchRow['status']): MatchRow => ({
  id, eventId: 7, matId: null, orderIndex: id, rulesetId: 3, lengthSec: 300, athleteAId: 1, athleteBId: 2,
  status, winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
})

function mount(matches: MatchRow[] = [], rs: RulesetRow | undefined = ruleset) {
  const detail: EventDetail = {
    event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'live', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
    teams: [], athletes: [], rulesets: [ruleset], mats: [], matches, candidateCount: 0,
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RulesetDialog detail={detail} open onOpenChange={() => {}} ruleset={rs} /></QueryClientProvider>)
}

describe('RulesetDialog', () => {
  it('authors the default length in the m:ss form the board renders and posts seconds', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Default length (m:ss)')
    expect(field).toHaveValue('5:00')
    await user.clear(field)
    await user.type(field, '300')
    expect(field).toHaveValue('3:00')
    await user.click(screen.getByRole('button', { name: 'Save ruleset' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/rulesets/3')).toBe(true))
    expect(f.body(f.calls.findIndex(c => c.url === '/api/rulesets/3')).defaultLengthSec).toBe(180)
  })

  it('will not commit a length the server would reject', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Default length (m:ss)')
    await user.clear(field)
    await user.type(field, '3100')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save ruleset' })).toBeDisabled()
  })

  it('prints a penalty with its sign in the same track as a positive value', async () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    await screen.findByRole('dialog')
    const values = screen.getAllByLabelText('Action points').map(i => (i as HTMLInputElement).value)
    expect(values).toEqual(['+2', '-1'])
  })

  it('refuses to remove a word this event has already scored with, and says why', async () => {
    fakeFetch(() => ({ json: {} }))
    mount([match(1, 'done'), match(2, 'live'), match(3, 'pending')])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Remove Takedown' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Remove Submission' })).toBeDisabled()
    expect(within(dialog).getByText('Used by 2 scored matches. Removing an action would rewrite a settled result.')).toBeInTheDocument()
  })

  it('still removes a word while every match under the ruleset is pending', async () => {
    fakeFetch(() => ({ json: {} }))
    mount([match(3, 'pending')])
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove Penalty' }))
    expect(screen.getAllByLabelText('Action points')).toHaveLength(1)
  })

  // The match events of a settled match store the action KEY. Regenerating a key from an
  // edited label orphans every score already recorded under the old one, which is exactly
  // what an append-only log exists to prevent.
  it('keeps a saved action key when its label is corrected under the lock', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount([match(1, 'done'), match(2, 'done')])
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    const label = within(dialog).getAllByLabelText('Action label')[0]
    await user.clear(label)
    await user.type(label, 'Take Down')
    await user.click(within(dialog).getByRole('button', { name: 'Save ruleset' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/rulesets/3')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/rulesets/3'))
    expect(body.actions[0]).toEqual({ key: 'takedown', label: 'Take Down', points: 2 })
  })

  it('keeps a saved key when nothing is locked either, because a key that shipped is forever', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount([match(3, 'pending')])
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    const actionLabel = within(dialog).getAllByLabelText('Action label')[0]
    await user.clear(actionLabel)
    await user.type(actionLabel, 'Takedown sweep')
    const terminalLabel = within(dialog).getAllByLabelText('Terminal label')[0]
    await user.clear(terminalLabel)
    await user.type(terminalLabel, 'Tap out')
    await user.click(within(dialog).getByRole('button', { name: 'Save ruleset' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/rulesets/3')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/rulesets/3'))
    expect(body.actions[0]).toEqual({ key: 'takedown', label: 'Takedown sweep', points: 2 })
    expect(body.terminals[0]).toEqual({ key: 'submission', label: 'Tap out', winType: 'submission' })
  })

  it('gives a row added in this session a key, without taking one an existing row owns', async () => {
    const f = fakeFetch(() => ({ json: {} }))
    mount([match(3, 'pending')])
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog')
    const existing = within(dialog).getAllByLabelText('Action label')[0]
    await user.clear(existing)
    await user.type(existing, 'Sweep')
    await user.click(within(dialog).getByRole('button', { name: 'Add action' }))
    const labels = within(dialog).getAllByLabelText('Action label')
    await user.type(labels[labels.length - 1], 'Takedown')
    await user.click(within(dialog).getByRole('button', { name: 'Save ruleset' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/rulesets/3')).toBe(true))
    const body = f.body(f.calls.findIndex(c => c.url === '/api/rulesets/3'))
    expect(body.actions[0].key).toBe('takedown')
    expect(body.actions[0].label).toBe('Sweep')
    expect(body.actions.at(-1)).toEqual({ key: 'takedown_2', label: 'Takedown', points: 2 })
    expect(new Set(body.actions.map((a: { key: string }) => a.key)).size).toBe(body.actions.length)
  })

  it('prints why the last action cannot be removed, where a reader can reach it', async () => {
    fakeFetch(() => ({ json: {} }))
    mount([], { ...ruleset, actions: [{ key: 'takedown', label: 'Takedown', points: 2 }] })
    const dialog = await screen.findByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: 'Remove Takedown' })
    expect(remove).toBeDisabled()
    expect(within(dialog).getByText('A ruleset needs at least one action.')).toBeInTheDocument()
    expect(remove).toHaveAccessibleDescription('A ruleset needs at least one action.')
    // A disabled button takes no pointer, so a title on it can never be shown.
    expect(remove).not.toHaveAttribute('title')
  })

  it('says why a terminal cannot be removed too, not only an action', async () => {
    fakeFetch(() => ({ json: {} }))
    mount([match(1, 'done')])
    const dialog = await screen.findByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: 'Remove Submission' })
    expect(within(dialog).getByText('Used by 1 scored match. Removing a terminal would rewrite a settled result.')).toBeInTheDocument()
    expect(remove).toHaveAccessibleDescription('Used by 1 scored match. Removing a terminal would rewrite a settled result.')
    expect(remove).not.toHaveAttribute('title')
  })
})
