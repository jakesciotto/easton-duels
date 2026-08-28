import { describe, it, expect, beforeEach } from 'vitest'
import { getAdminToken, setAdminToken, clearAdminToken, getMatBinding, setMatBinding, clearMatBinding } from '@/lib/auth'

beforeEach(() => localStorage.clear())

describe('auth storage', () => {
  it('stores and clears the admin token', () => {
    expect(getAdminToken()).toBeNull()
    setAdminToken('t')
    expect(getAdminToken()).toBe('t')
    clearAdminToken()
    expect(getAdminToken()).toBeNull()
  })
  it('stores and clears the mat binding and survives bad json', () => {
    const b = { eventId: 1, matId: 2, matNumber: 2, eventName: 'X', token: 'm' }
    setMatBinding(b)
    expect(getMatBinding()).toEqual(b)
    localStorage.setItem('duels:mat', '{nope')
    expect(getMatBinding()).toBeNull()
    clearMatBinding()
    expect(localStorage.getItem('duels:mat')).toBeNull()
  })
})
