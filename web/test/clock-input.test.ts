import { describe, it, expect } from 'vitest'
import { clockToSec, maskClock } from '@/routes/event/clock-input'

describe('m:ss input mask', () => {
  it('fills digits from the right so there is never a bare number to interpret', () => {
    expect(maskClock('5')).toBe('5')
    expect(maskClock('50')).toBe('50')
    expect(maskClock('500')).toBe('5:00')
    expect(maskClock('1230')).toBe('12:30')
    expect(maskClock('12:30')).toBe('12:30')
    expect(maskClock('5m00s')).toBe('5:00')
    expect(maskClock('123456')).toBe('12:34')
  })

  it('commits only a real clock inside the length the server accepts', () => {
    expect(clockToSec('5:00')).toBe(300)
    expect(clockToSec('3:00')).toBe(180)
    expect(clockToSec('45')).toBe(45)
    expect(clockToSec('0:20')).toBeNull()
    expect(clockToSec('31:00')).toBeNull()
    expect(clockToSec('1:80')).toBeNull()
    expect(clockToSec('')).toBeNull()
  })
})
