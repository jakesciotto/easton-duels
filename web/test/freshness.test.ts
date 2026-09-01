import { describe, it, expect } from 'vitest'
import { ageSeconds, formatAge, isStale, headerFreshnessLevel } from '@/lib/freshness'

describe('ageSeconds', () => {
  it('is null before any successful poll', () => {
    expect(ageSeconds(null, 100_000)).toBeNull()
  })

  it('floors to whole seconds', () => {
    expect(ageSeconds(1000, 1000 + 4_900)).toBe(4)
    expect(ageSeconds(1000, 1000 + 5_000)).toBe(5)
  })

  it('never goes negative', () => {
    expect(ageSeconds(2000, 1000)).toBe(0)
  })
})

describe('formatAge', () => {
  it('prints a literal number of seconds, not a word', () => {
    expect(formatAge(14)).toBe('14s')
    expect(formatAge(0)).toBe('0s')
  })
})

describe('isStale', () => {
  it('is never stale before any successful poll', () => {
    expect(isStale(null, 1_000_000, 1000)).toBe(false)
  })

  it('is not stale at exactly three poll intervals', () => {
    expect(isStale(0, 3000, 1000)).toBe(false)
  })

  it('is stale just past three poll intervals', () => {
    expect(isStale(0, 3001, 1000)).toBe(true)
  })

  it('scales the threshold with the current poll interval (7.15: 3, 9 or 15 seconds)', () => {
    expect(isStale(0, 9000, 3000)).toBe(false)
    expect(isStale(0, 9001, 3000)).toBe(true)
    expect(isStale(0, 15000, 5000)).toBe(false)
    expect(isStale(0, 15001, 5000)).toBe(true)
  })
})

describe('headerFreshnessLevel', () => {
  it('is fresh with no age yet', () => {
    expect(headerFreshnessLevel(null)).toBe('fresh')
  })

  it('is fresh under five seconds, attend past five, fault past fifteen', () => {
    expect(headerFreshnessLevel(5)).toBe('fresh')
    expect(headerFreshnessLevel(6)).toBe('attend')
    expect(headerFreshnessLevel(15)).toBe('attend')
    expect(headerFreshnessLevel(16)).toBe('fault')
  })
})
