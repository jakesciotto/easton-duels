import { describe, it, expect } from 'vitest'
import { beltDistance } from '../src/matchmaker/cost.js'

describe('beltDistance', () => {
  it('counts families whole and stripes as a third', () => {
    expect(beltDistance('grey', 'grey')).toBe(0)
    expect(beltDistance('grey-white', 'grey-black')).toBeCloseTo(0.66, 5)
    expect(beltDistance('grey', 'yellow')).toBe(1)
    expect(beltDistance('white', 'green-black')).toBeCloseTo(4 + 0.33, 5)
    expect(beltDistance(null, 'grey')).toBe(2)
    expect(beltDistance('grey', 'chartreuse')).toBe(2)
  })
})
