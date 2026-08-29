import { describe, it, expect } from 'vitest'
import { defaultOutcome } from '@/routes/event/entry-defaults'

describe('defaultOutcome', () => {
  it('picks the higher score on points and asks for a decision on a tie', () => {
    expect(defaultOutcome(6, 2)).toEqual({ winner: 'a', winType: 'points' })
    expect(defaultOutcome(0, 4)).toEqual({ winner: 'b', winType: 'points' })
    expect(defaultOutcome(3, 3)).toEqual({ winner: null, winType: 'decision' })
  })
})
