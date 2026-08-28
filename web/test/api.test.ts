import { describe, it, expect, afterEach, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { fakeFetch } from './fakes'

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('sends json and the bearer token, and parses the reply', async () => {
    const f = fakeFetch(() => ({ json: { ok: 1 } }))
    const r = await api<{ ok: number }>('/api/x', { method: 'POST', body: { a: 1 }, token: 'tok' })
    expect(r).toEqual({ ok: 1 })
    const h = f.calls[0].init?.headers as Record<string, string>
    expect(h.authorization).toBe('Bearer tok')
    expect(h['content-type']).toBe('application/json')
    expect(f.body(0)).toEqual({ a: 1 })
  })
  it('returns undefined on 204 and throws ApiError with code and details otherwise', async () => {
    fakeFetch(url => url.endsWith('/gone') ? { status: 204 } : { status: 409, json: { error: { code: 'sequence', message: 'stale', currentSeq: 3 } } })
    expect(await api('/api/gone', { method: 'DELETE' })).toBeUndefined()
    const err = (await api('/api/x').catch(e => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('sequence')
    expect(err.details.currentSeq).toBe(3)
  })
})
