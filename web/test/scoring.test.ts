import { describe, it, expect, afterEach, vi } from 'vitest'
import { postMatchEvent } from '@/lib/scoring'
import { ApiError } from '@/lib/api'
import { fakeFetch } from './fakes'

afterEach(() => vi.unstubAllGlobals())

describe('postMatchEvent', () => {
  it('retries a network failure with the same id', async () => {
    let n = 0
    const f = fakeFetch(() => { n++; if (n === 1) throw new TypeError('network'); return { json: { match: { id: 10 }, version: 2 } } })
    const r = await postMatchEvent(10, 'tok', { type: 'score', athleteId: 100, actionKey: 'takedown', lastSeq: 0 })
    expect(r.version).toBe(2)
    expect(f.calls).toHaveLength(2)
    expect(f.body(0).id).toBe(f.body(1).id)
    expect(f.body(0).id.length).toBeGreaterThan(8)
  })
  it('does not retry an ApiError', async () => {
    const f = fakeFetch(() => ({ status: 409, json: { error: { code: 'sequence', message: 'stale', currentSeq: 4 } } }))
    await expect(postMatchEvent(10, 'tok', { type: 'clock_start', lastSeq: 0 })).rejects.toBeInstanceOf(ApiError)
    expect(f.calls).toHaveLength(1)
  })
})
