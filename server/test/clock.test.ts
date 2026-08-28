import { describe, it, expect } from 'vitest'
import { remainingMs, formatClock, isRunning } from '../src/shared/clock.js'

const T0 = Date.parse('2026-08-27T18:00:00.000Z')

describe('remainingMs', () => {
  it('subtracts elapsed when paused', () => {
    expect(remainingMs({ elapsedMs: 60_000, startedAt: null, lengthMs: 300_000 }, T0)).toBe(240_000)
  })
  it('subtracts running time since startedAt', () => {
    const clock = { elapsedMs: 60_000, startedAt: new Date(T0).toISOString(), lengthMs: 300_000 }
    expect(remainingMs(clock, T0 + 10_000)).toBe(230_000)
  })
  it('clamps at zero', () => {
    const clock = { elapsedMs: 290_000, startedAt: new Date(T0).toISOString(), lengthMs: 300_000 }
    expect(remainingMs(clock, T0 + 60_000)).toBe(0)
  })
  it('ignores a device clock that is behind the server', () => {
    const clock = { elapsedMs: 0, startedAt: new Date(T0).toISOString(), lengthMs: 300_000 }
    expect(remainingMs(clock, T0 - 5_000)).toBe(300_000)
  })
})

describe('formatClock', () => {
  it('rounds up to the next whole second', () => {
    expect(formatClock(299_001)).toBe('5:00')
    expect(formatClock(59_999)).toBe('1:00')
    expect(formatClock(1)).toBe('0:01')
    expect(formatClock(0)).toBe('0:00')
  })
})

describe('isRunning', () => {
  it('is true only when startedAt is set', () => {
    expect(isRunning({ elapsedMs: 0, startedAt: null, lengthMs: 1 })).toBe(false)
    expect(isRunning({ elapsedMs: 0, startedAt: '2026-08-27T18:00:00.000Z', lengthMs: 1 })).toBe(true)
  })
})
