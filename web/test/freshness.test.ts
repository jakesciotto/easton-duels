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
    expect(headerFreshnessLevel(null, 1000)).toBe('fresh')
  })

  it('stays fresh for a whole poll cycle, so a healthy app never reports late', () => {
    // Seen in the browser: the readout sawtoothed 0, 1, 2, 0 on a healthy app, because
    // the threshold was a fixed five seconds while the interval is adaptive and reaches
    // five seconds itself. Late means a poll was MISSED, not that a second passed.
    for (const interval of [1000, 3000, 5000]) {
      const cycle = Math.ceil(interval / 1000)
      for (let age = 0; age <= cycle; age++) {
        expect(headerFreshnessLevel(age, interval), `${age}s at a ${interval}ms interval`).toBe('fresh')
      }
    }
  })

  it('reports late once a poll is missed, and stale after three', () => {
    expect(headerFreshnessLevel(2, 1000)).toBe('fresh')
    expect(headerFreshnessLevel(3, 1000)).toBe('attend')
    expect(headerFreshnessLevel(3, 1000)).toBe('attend')
    expect(headerFreshnessLevel(4, 1000)).toBe('fault')
    // At the slowest interval the same rule holds, just later.
    expect(headerFreshnessLevel(10, 5000)).toBe('fresh')
    expect(headerFreshnessLevel(12, 5000)).toBe('attend')
    expect(headerFreshnessLevel(16, 5000)).toBe('fault')
  })

  // The level and the clock's own stale state read one fact, so a header that says the
  // data is fine can never sit above a board that has stopped trusting its own numbers.
  it('turns fault exactly where the clock turns stale', () => {
    for (const interval of [1000, 3000, 5000]) {
      for (let age = 0; age <= 30; age++) {
        const late = headerFreshnessLevel(age, interval) === 'fault'
        expect(late, `${age}s at ${interval}ms`).toBe(isStale(0, age * 1000, interval))
      }
    }
  })
})
