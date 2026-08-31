import { describe, it, expect } from 'vitest'
import { checkLimit } from '../src/auth/dbRateLimit.js'
import { freshDb } from './fixtures.js'

const HOUR_MS = 60 * 60 * 1000

describe('checkLimit', () => {
  it('allows the 10th pin attempt and refuses the 11th with a positive retryAfterSec', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) {
      expect((await checkLimit(db, 'pin', 'ip-1', i * 1000)).allowed).toBe(true)
    }
    const eleventh = await checkLimit(db, 'pin', 'ip-1', 10_000)
    expect(eleventh.allowed).toBe(false)
    expect(eleventh.retryAfterSec).toBeGreaterThan(0)
  })

  it('allows the 20th bind attempt and refuses the 21st', async () => {
    const db = await freshDb()
    for (let i = 0; i < 20; i++) {
      expect((await checkLimit(db, 'bind', 'ip-2', i * 1000)).allowed).toBe(true)
    }
    expect((await checkLimit(db, 'bind', 'ip-2', 20_000)).allowed).toBe(false)
  })

  it('resets the window once window_start is more than an hour old', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await checkLimit(db, 'pin', 'ip-3', 0)
    expect((await checkLimit(db, 'pin', 'ip-3', 0)).allowed).toBe(false)
    const afterWindow = await checkLimit(db, 'pin', 'ip-3', HOUR_MS + 1)
    expect(afterWindow.allowed).toBe(true)
    expect(afterWindow.retryAfterSec).toBe(0)
  })

  it('keeps scopes independent for the same key', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await checkLimit(db, 'pin', 'shared-ip', i)
    expect((await checkLimit(db, 'pin', 'shared-ip', 10)).allowed).toBe(false)
    expect((await checkLimit(db, 'bind', 'shared-ip', 10)).allowed).toBe(true)
  })

  it('keeps different keys independent within the same scope', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await checkLimit(db, 'pin', 'ip-a', i)
    expect((await checkLimit(db, 'pin', 'ip-a', 10)).allowed).toBe(false)
    expect((await checkLimit(db, 'pin', 'ip-b', 10)).allowed).toBe(true)
  })
})
