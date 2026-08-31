import { describe, it, expect } from 'vitest'
import { checkLimit, recordFailure } from '../src/auth/dbRateLimit.js'
import { freshDb } from './fixtures.js'

const HOUR_MS = 60 * 60 * 1000

describe('checkLimit', () => {
  it('allows through ten pin failures and refuses the next attempt with a positive retryAfterSec', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) {
      expect((await checkLimit(db, 'pin', 'ip-1', i * 1000)).allowed).toBe(true)
      await recordFailure(db, 'pin', 'ip-1', i * 1000)
    }
    const eleventh = await checkLimit(db, 'pin', 'ip-1', 10_000)
    expect(eleventh.allowed).toBe(false)
    expect(eleventh.retryAfterSec).toBeGreaterThan(0)
  })

  it('allows through twenty bind failures and refuses the next attempt', async () => {
    const db = await freshDb()
    for (let i = 0; i < 20; i++) {
      expect((await checkLimit(db, 'bind', 'ip-2', i * 1000)).allowed).toBe(true)
      await recordFailure(db, 'bind', 'ip-2', i * 1000)
    }
    expect((await checkLimit(db, 'bind', 'ip-2', 20_000)).allowed).toBe(false)
  })

  it('never spends the budget on attempts that are not recorded as failures', async () => {
    const db = await freshDb()
    for (let i = 0; i < 50; i++) expect((await checkLimit(db, 'pin', 'ip-ok', i)).allowed).toBe(true)
    expect((await checkLimit(db, 'pin', 'ip-ok', 50)).retryAfterSec).toBe(0)
  })

  it('resets the window once window_start is more than an hour old', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await recordFailure(db, 'pin', 'ip-3', 0)
    expect((await checkLimit(db, 'pin', 'ip-3', 0)).allowed).toBe(false)
    const afterWindow = await checkLimit(db, 'pin', 'ip-3', HOUR_MS + 1)
    expect(afterWindow.allowed).toBe(true)
    expect(afterWindow.retryAfterSec).toBe(0)
    await recordFailure(db, 'pin', 'ip-3', HOUR_MS + 1)
    expect((await checkLimit(db, 'pin', 'ip-3', HOUR_MS + 2)).allowed).toBe(true)
  })

  it('keeps scopes independent for the same key', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await recordFailure(db, 'pin', 'shared-ip', i)
    expect((await checkLimit(db, 'pin', 'shared-ip', 10)).allowed).toBe(false)
    expect((await checkLimit(db, 'bind', 'shared-ip', 10)).allowed).toBe(true)
  })

  it('keeps different keys independent within the same scope', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await recordFailure(db, 'pin', 'ip-a', i)
    expect((await checkLimit(db, 'pin', 'ip-a', 10)).allowed).toBe(false)
    expect((await checkLimit(db, 'pin', 'ip-b', 10)).allowed).toBe(true)
  })
})
