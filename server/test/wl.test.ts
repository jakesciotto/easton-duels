import { describe, it, expect } from 'vitest'
import { WlClient, WlRequestError } from '../src/roster/wl.js'

type Reply = { status?: number; json: unknown }
function fakeFetch(script: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = script.shift()
    if (!r) throw new Error('fetch script exhausted')
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchFn, calls }
}
const cfg = { clientId: 'id', clientSecret: 'secret', region: '1', business: '9' }
const token = { json: { access_token: 'tok', expires_in: 3600 } }
const noSleep = async () => {}

describe('WlClient', () => {
  it('fetches a token once and injects region and business', async () => {
    const { fetchFn, calls } = fakeFetch([token, { json: { a_location: { 5: { k_business: '100001', s_title: ' Test Gym - North ', text_city: 'Boulder' } } } }, { json: { a_location: [] } }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    const locs = await wl.listLocations()
    expect(locs).toEqual([{ kBusiness: '100001', title: 'Test Gym - North', city: 'Boulder' }])
    await wl.listLocations()
    expect(calls).toHaveLength(3)
    expect(calls[1].url).toContain('id_region=1')
    expect(calls[1].url).toContain('k_business=9')
    expect(((calls[1].init?.headers ?? {}) as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('polls the report until status 3 and maps rows by field name', async () => {
    const { fetchFn, calls } = fakeFetch([
      token,
      { json: { id_report_status: 2 } },
      { json: { id_report_status: 3, a_field: ['uid', 'text_rank', 'text_rank_category', 'o_client.text_first', 'o_client.text_last', 'o_rank_promotion_date.dtl_promotion_date'], a_row: [['7', ' Grey Belt ', 'Kids IBJJF Belts', 'Zoe', 'Martin', '2026-01-01'], ['', 'x', 'y', 'No', 'Body', '']] } },
    ])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    const rows = await wl.fetchKidsBeltRecords('100001', 'Boulder')
    expect(rows).toEqual([{ uid: '7', kBusiness: '100001', location: 'Boulder', firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-01-01' }])
    const body = JSON.parse(String(calls[1].init?.body))
    expect(body.s_sql.startsWith('select ')).toBe(true)
    expect(body.i_offset).toBe(0)
  })

  it('retries a 5xx with backoff and gives up after maxAttempts', async () => {
    const { fetchFn } = fakeFetch([token, { status: 502, json: {} }, { status: 502, json: {} }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep, maxAttempts: 2 })
    await expect(wl.fetchKidsBeltRecords('1', 'X')).rejects.toBeInstanceOf(WlRequestError)
  })

  it('refuses a page whose row count equals the limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => [String(i), 'Grey Belt', 'Kids', 'A', 'B', ''])
    const { fetchFn } = fakeFetch([token, { json: { id_report_status: 3, a_field: ['uid', 'text_rank', 'text_rank_category', 'o_client.text_first', 'o_client.text_last', 'o_rank_promotion_date.dtl_promotion_date'], a_row: rows } }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep, kidsLimit: 3 })
    await expect(wl.fetchKidsBeltRecords('1', 'X')).rejects.toThrow(/truncated/)
  })
})
