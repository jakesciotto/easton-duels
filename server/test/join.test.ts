import { describe, it, expect } from 'vitest'
import { buildCandidates } from '../src/roster/join.js'
import type { WlBeltRecord } from '../src/roster/types.js'

const rec = (o: Partial<WlBeltRecord>): WlBeltRecord => ({
  uid: 'w0', kBusiness: '100001', location: 'North', firstName: 'Jonas', lastName: 'Blake',
  rankTitle: 'Yellow Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2024-05-14 06:00:00', ...o,
})

describe('buildCandidates', () => {
  it('keeps the day of a promotion datetime, and a bare date or nothing as it is', () => {
    const [withTime] = buildCandidates([rec({})], [])
    expect(withTime.promotedAt).toBe('2024-05-14')
    const [dateOnly] = buildCandidates([rec({ promotedAt: '2026-03-14' })], [])
    expect(dateOnly.promotedAt).toBe('2026-03-14')
    const [none] = buildCandidates([rec({ promotedAt: null })], [])
    expect(none.promotedAt).toBeNull()
  })
})
