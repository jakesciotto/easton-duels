import { describe, it, expect } from 'vitest'
import { normalize, dice } from '@shared/similarity'

describe('normalize', () => {
  it('lowercases and keeps only letters and digits', () => {
    expect(normalize('Weight (lbs)')).toBe('weightlbs')
    expect(normalize('First Name')).toBe('firstname')
    expect(normalize('  Rank  ')).toBe('rank')
  })
})

describe('dice', () => {
  it('scores equal strings at 1', () => {
    expect(dice('weight', 'weight')).toBe(1)
    expect(dice('Weight', 'WEIGHT')).toBe(1)
  })

  it('scores disjoint strings at 0', () => {
    expect(dice('abc', 'xyz')).toBe(0)
  })

  it('scores "weight lbs" against "weight" above 0.6', () => {
    expect(dice('weight lbs', 'weight')).toBeGreaterThan(0.6)
  })

  it('scores "lb" against "belt" below 0.6', () => {
    expect(dice('lb', 'belt')).toBeLessThan(0.6)
  })

  it('ignores case and punctuation', () => {
    expect(dice('Weight!!!', 'weight')).toBe(1)
    expect(dice('First-Name', 'first name')).toBe(1)
  })

  it('answers 1 only for equal normalized single character strings, else 0', () => {
    expect(dice('a', 'a')).toBe(1)
    expect(dice('a', 'b')).toBe(0)
    expect(dice('a', 'ab')).toBe(0)
  })
})
