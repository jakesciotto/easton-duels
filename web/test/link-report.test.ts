import { describe, it, expect } from 'vitest'
import { reportLines } from '@/routes/event/link-report'
import type { SyncReport } from '@/lib/types'

const CLEAN: SyncReport = {
  linked: [], refreshed: 0, changed: [],
  suggested: [], ambiguous: [], unmatched: [], gone: [],
}

describe('reportLines', () => {
  it('always counts what the sync did, even when it did nothing', () => {
    expect(reportLines(CLEAN)).toEqual(['Linked 0. Refreshed 0, 0 changed.'])
  })

  it('counts the links, the refreshes and the rows that changed', () => {
    const lines = reportLines({ ...CLEAN, linked: ['Zoe Martin', 'Kai Wong'], refreshed: 5, changed: ['Zoe Martin'] })
    expect(lines[0]).toBe('Linked 2. Refreshed 5, 1 changed.')
  })

  it('names each near match on its own line, with the candidate and the location', () => {
    const lines = reportLines({
      ...CLEAN,
      suggested: [
        { athleteId: 1, name: 'Mateo Rivera', candidate: 'Mateo Rivera-Lopez', location: 'Boulder', score: 0.82 },
        { athleteId: 2, name: 'Ana Ruiz', candidate: 'Ana Ruiz-Diaz', location: 'Denver', score: 0.71 },
      ],
    })
    expect(lines).toContain('To confirm: Mateo Rivera looks like Mateo Rivera-Lopez, Boulder.')
    expect(lines).toContain('To confirm: Ana Ruiz looks like Ana Ruiz-Diaz, Denver.')
  })

  it('names the rows a person has to finish by hand', () => {
    const lines = reportLines({
      ...CLEAN,
      ambiguous: ['Sam Lee', 'Mia Park'],
      unmatched: ['Ben Oyelaran'],
      gone: ['Noah Kid'],
    })
    expect(lines).toContain('Two candidates, link by hand: Sam Lee, Mia Park.')
    expect(lines).toContain('Not found: Ben Oyelaran.')
    expect(lines).toContain('Gone from WellnessLiving: Noah Kid.')
  })

  it('prints the lines in the order spec 7.2 states', () => {
    const lines = reportLines({
      linked: ['Zoe Martin'], refreshed: 2, changed: ['Kai Wong'],
      suggested: [{ athleteId: 1, name: 'Mateo Rivera', candidate: 'Mateo Rivera-Lopez', location: 'Boulder', score: 0.82 }],
      ambiguous: ['Sam Lee'], unmatched: ['Ben Oyelaran'], gone: ['Noah Kid'],
    })
    expect(lines).toEqual([
      'Linked 1. Refreshed 2, 1 changed.',
      'To confirm: Mateo Rivera looks like Mateo Rivera-Lopez, Boulder.',
      'Two candidates, link by hand: Sam Lee.',
      'Not found: Ben Oyelaran.',
      'Gone from WellnessLiving: Noah Kid.',
    ])
  })

  it('leaves out every list that names nobody', () => {
    const lines = reportLines({ ...CLEAN, linked: ['Zoe Martin'] })
    expect(lines).toHaveLength(1)
  })
})
