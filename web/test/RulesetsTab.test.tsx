import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RulesetsTab } from '@/routes/event/RulesetsTab'
import { setAdminToken } from '@/lib/auth'
import type { EventDetail, MatchRow, RulesetRow } from '@/lib/types'
import { fakeFetch } from './fakes'

beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

// jsdom loads no stylesheet, so the one utility under test is declared here and the
// cascade is walked by hand: text-transform inherits, and jsdom resolves no inherited
// value. What is asserted is the case the reader sees, not a class on one element.
const sheet = document.createElement('style')
sheet.textContent = '.uppercase { text-transform: uppercase; }'
document.head.append(sheet)

function uppercased(el: Element | null): boolean {
  for (let node = el; node; node = node.parentElement) {
    if (getComputedStyle(node).textTransform === 'uppercase') return true
  }
  return false
}

const ruleset: RulesetRow = {
  id: 1, eventId: 7, name: 'Default', defaultLengthSec: 300,
  actions: [{ key: 'takedown', label: 'Takedown', points: 2 }],
  terminals: [{ key: 'pin', label: 'Pin', winType: 'submission' }],
}

const match = (id: number, rulesetId: number, status: MatchRow['status'] = 'pending'): MatchRow => ({
  id, eventId: 7, matId: null, orderIndex: id, rulesetId, lengthSec: 300, athleteAId: 1, athleteBId: 2,
  status, winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null,
})

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', maxAgeGap: 1, maxWeightGap: 10, sameGender: false, createdAt: 'x' },
  teams: [], athletes: [], mats: [], matches: [], candidateCount: 0,
  rulesets: [ruleset],
}

function mount(over: Partial<EventDetail> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><RulesetsTab detail={{ ...detail, ...over }} /></QueryClientProvider>)
}

function cardFor(name: string): HTMLElement {
  const card = screen.getByText(name).closest('[data-slot="field-set"]')
  if (!card) throw new Error(`no ruleset card for ${name}`)
  return card as HTMLElement
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

  // Refuse rather than ask only works if the refusal is legible. An inert Delete with no
  // reason on the card is a control the organizer clicks until they decide it is broken.
  it('prints why Delete is refused for a ruleset that already has a match', () => {
    fakeFetch(() => ({ json: {} }))
    const second: RulesetRow = { ...ruleset, id: 2, name: 'Wrestling' }
    mount({ rulesets: [ruleset, second], matches: [match(1, 1)] })
    const card = cardFor('Default')
    const del = within(card).getByRole('button', { name: 'Delete' })
    expect(del).toBeDisabled()
    expect(within(card).getByText('Used by 1 match')).toBeInTheDocument()
    expect(del).toHaveAccessibleDescription('Used by 1 match')
    // The other card is untouched: an explained refusal is per ruleset, not a mode.
    const other = within(cardFor('Wrestling')).getByRole('button', { name: 'Delete' })
    expect(other).toBeEnabled()
  })

  it('counts the matches it names, so the number is one the organizer can check', () => {
    fakeFetch(() => ({ json: {} }))
    mount({ matches: [match(1, 1), match(2, 1, 'done'), match(3, 1, 'live')] })
    expect(within(cardFor('Default')).getByText('Used by 3 matches')).toBeInTheDocument()
  })

  it('says the event needs a ruleset when this is the last one', () => {
    fakeFetch(() => ({ json: {} }))
    mount()
    const card = cardFor('Default')
    const del = within(card).getByRole('button', { name: 'Delete' })
    expect(del).toBeDisabled()
    expect(within(card).getByText('The event needs one ruleset')).toBeInTheDocument()
    expect(del).toHaveAccessibleDescription('The event needs one ruleset')
  })

  it('deletes a ruleset that nothing refuses', async () => {
    const f = fakeFetch(() => ({ status: 204 }))
    const second: RulesetRow = { ...ruleset, id: 2, name: 'Wrestling' }
    mount({ rulesets: [ruleset, second] })
    const user = userEvent.setup()
    await user.click(within(cardFor('Wrestling')).getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(f.calls.some(c => c.url === '/api/rulesets/2')).toBe(true))
  })

  // 6.7 asks for a titled ledger field, not a column head band. A head hard codes
  // uppercase and text-transform inherits, so the ruleset name and both controls would
  // shout in the only uppercase buttons in the product.
  it('renders a ruleset name and its controls in the case they were written', () => {
    fakeFetch(() => ({ json: {} }))
    mount({ rulesets: [{ ...ruleset, name: 'Kids gi, 4 minutes' }] })
    const card = cardFor('Kids gi, 4 minutes')
    expect(uppercased(within(card).getByText('Kids gi, 4 minutes'))).toBe(false)
    expect(uppercased(within(card).getByRole('button', { name: 'Edit' }))).toBe(false)
    expect(uppercased(within(card).getByRole('button', { name: 'Delete' }))).toBe(false)
    expect(uppercased(within(card).getByText('The event needs one ruleset'))).toBe(false)
  })
})
