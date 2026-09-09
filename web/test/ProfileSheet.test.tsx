import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ProfileSheet, changeSentence, NOTHING_CHANGED } from '@/routes/event/ProfileSheet'
import type { AthleteRow, EventDetail } from '@/lib/types'

// The sheet stamps a local time of day, so the fixture is built in local time too.
const SYNCED_AT = new Date(2026, 9, 3, 15, 41, 0).toISOString()

const kid = (over: Partial<AthleteRow> = {}): AthleteRow => ({
  id: 100, eventId: 7, teamId: 1, firstName: 'Mateo', lastName: 'Rivera',
  age: 8, ageSource: 'manual', weightLbs: 62, weightSource: 'leaderboard',
  belt: 'grey-white', gender: 'Male', source: 'wl', wlUid: 'w1', wlLocation: 'Boulder',
  leaderboardId: 'mateo-rivera', erp: 3.4,
  promotedAt: '2026-03-14', syncedAt: SYNCED_AT,
  syncChanges: { belt: { from: 'grey', to: 'grey-white' }, erp: { from: 3.1, to: 3.4 } },
  suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [], ...over,
})

const detail: EventDetail = {
  event: { id: 7, name: 'Fall Duels', date: '2026-10-03', matCount: 1, matCode: '0420', status: 'setup', mode: 'live', sameGender: false, createdAt: 'x' },
  teams: [{ id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 }, { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 }],
  athletes: [], rulesets: [], mats: [], matches: [], candidateCount: 0,
}

function mount(k: AthleteRow | null) {
  render(<ProfileSheet detail={detail} kid={k} open={k !== null} onOpenChange={() => {}} />)
}

const lineFor = (label: string): HTMLElement =>
  screen.getByText(label).closest('[data-slot="list-row"]') as HTMLElement

describe('changeSentence', () => {
  it('names every field the last sync moved', () => {
    expect(changeSentence({ belt: { from: 'grey', to: 'grey-white' }, erp: { from: 3.1, to: 3.4 } }))
      .toBe('Belt grey to grey-white. ERP 3.1 to 3.4.')
  })

  it('says so when the sync changed nothing', () => {
    expect(changeSentence({})).toBe(NOTHING_CHANGED)
    expect(changeSentence(null)).toBe(NOTHING_CHANGED)
  })

  it('reads a value that was not there as none', () => {
    expect(changeSentence({ age: { from: null, to: 9 } })).toBe('Age none to 9.')
  })

  it('reads the row WellnessLiving no longer holds', () => {
    expect(changeSentence({ pool: { from: 'present', to: 'missing' } })).toBe('Pool present to missing.')
  })
})

describe('ProfileSheet', () => {
  it('renders nothing without a competitor', () => {
    mount(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('heads the sheet with the name and the team', async () => {
    mount(kid())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Mateo Rivera')).toBeInTheDocument()
    expect(within(dialog).getByText('Ridgeline')).toBeInTheDocument()
  })

  it('prints one line per fact', () => {
    mount(kid())
    expect(lineFor('Location')).toHaveTextContent('Boulder')
    expect(lineFor('Belt')).toHaveTextContent('Grey / White, since 2026-03-14')
    expect(lineFor('ERP')).toHaveTextContent('3.4')
    expect(lineFor('Age')).toHaveTextContent('8, typed')
    expect(lineFor('Weight')).toHaveTextContent('62, leaderboard')
    expect(lineFor('Gender')).toHaveTextContent('Male')
    expect(lineFor('WellnessLiving')).toHaveTextContent('Linked')
    expect(lineFor('Last synced')).toHaveTextContent('3:41 pm')
    expect(lineFor('Last sync changed')).toHaveTextContent('Belt grey to grey-white. ERP 3.1 to 3.4.')
  })

  it('says what it does not hold', () => {
    mount(kid({
      belt: null, promotedAt: null, erp: null, age: null, ageSource: null,
      weightLbs: null, weightSource: null, gender: null, wlUid: null, wlLocation: null,
      syncedAt: null, syncChanges: null,
    }))
    expect(lineFor('Location')).toHaveTextContent('Unknown')
    expect(lineFor('Belt')).toHaveTextContent('No belt')
    expect(lineFor('ERP')).toHaveTextContent('unrated')
    expect(lineFor('Age')).toHaveTextContent('missing')
    expect(lineFor('Weight')).toHaveTextContent('missing')
    expect(lineFor('Gender')).toHaveTextContent('Unknown')
    expect(lineFor('WellnessLiving')).toHaveTextContent('Not linked')
    expect(lineFor('Last synced')).toHaveTextContent('Never')
    expect(lineFor('Last sync changed')).toHaveTextContent(NOTHING_CHANGED)
  })

  it('says the belt date is unknown when WellnessLiving carries no promotion', () => {
    mount(kid({ belt: 'grey', promotedAt: null }))
    expect(lineFor('Belt')).toHaveTextContent('Grey, date unknown')
  })

  // Read only: the sheet reports and never writes, so Close is the only control.
  it('offers Close and nothing else', () => {
    mount(kid())
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(within(footer).getAllByRole('button')).toHaveLength(1)
    expect(within(footer).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
