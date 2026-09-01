import { describe, it, expect } from 'vitest'
import { fetchCompetitors } from '../src/roster/leaderboard.js'

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url))
    return handler(String(url), init)
  }) as typeof fetch
  return { fetchFn, calls }
}
const cfg = { url: 'https://x.supabase.co/', key: 'k' }
const row = (i: number) => ({ id: `kid-${i}`, name: `Kid ${i}`, belt: 'grey', age_group: '8-9', gender: 'Male', weight_class: '-60 lbs', academy: 'Ridgeline', erp: 5 })

describe('fetchCompetitors', () => {
  it('pages by 1000 using the Range header and sends the key twice', async () => {
    const { fetchFn, calls } = fakeFetch((url, init) => {
      const range = ((init?.headers ?? {}) as Record<string, string>).range
      const from = Number(range.split('-')[0])
      const count = from === 0 ? 1000 : 3
      return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => row(from + i))), { status: 206 })
    })
    const r = await fetchCompetitors(cfg, fetchFn)
    expect(r.competitors).toHaveLength(1003)
    expect(r.hasErp).toBe(true)
    expect(r.competitors[0]).toEqual({ id: 'kid-0', name: 'Kid 0', belt: 'grey', ageGroup: '8-9', gender: 'Male', weightClass: '-60 lbs', academy: 'Ridgeline', erp: 5 })
    expect(calls[0]).toContain('/rest/v1/competitors?select=id,name,belt,age_group,gender,weight_class,academy,erp')
    expect(calls[0]).toContain('age_division=eq.kids')
  })

  it('falls back to no erp column on 42703', async () => {
    let first = true
    const { fetchFn } = fakeFetch(url => {
      if (first && url.includes(',erp')) {
        first = false
        return new Response(JSON.stringify({ code: '42703', message: 'column competitors.erp does not exist' }), { status: 400 })
      }
      const { erp: _erp, ...rest } = row(1)
      return new Response(JSON.stringify([rest]), { status: 200 })
    })
    const r = await fetchCompetitors(cfg, fetchFn)
    expect(r.hasErp).toBe(false)
    expect(r.competitors[0].erp).toBeNull()
  })

  it('throws on other failures', async () => {
    const { fetchFn } = fakeFetch(() => new Response('nope', { status: 500 }))
    await expect(fetchCompetitors(cfg, fetchFn)).rejects.toThrow(/500/)
  })
})
