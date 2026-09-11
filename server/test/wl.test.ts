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
    const { fetchFn, calls } = fakeFetch([token, { json: { a_location: { 5: { k_business: '100001', s_title: ' Test Gym - North ', text_city: 'Ridgeline' } } } }, { json: { a_location: [] } }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    const locs = await wl.listLocations()
    expect(locs).toEqual([{ kBusiness: '100001', title: 'Test Gym - North', city: 'Ridgeline' }])
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
    const rows = await wl.fetchKidsBeltRecords('100001', 'Ridgeline')
    expect(rows).toEqual([{ uid: '7', kBusiness: '100001', location: 'Ridgeline', firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-01-01' }])
    const body = JSON.parse(String(calls[1].init?.body))
    expect(body.s_sql.startsWith('select ')).toBe(true)
    expect(body.i_offset).toBe(0)
  })

  it('retries a 5xx with backoff and gives up after maxAttempts', async () => {
    const { fetchFn } = fakeFetch([token, { status: 502, json: {} }, { status: 502, json: {} }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep, maxAttempts: 2 })
    await expect(wl.fetchKidsBeltRecords('1', 'X')).rejects.toBeInstanceOf(WlRequestError)
  })

  it('threads cfg.kidsCategory into an exact-match query', async () => {
    const { fetchFn, calls } = fakeFetch([
      token,
      { json: { id_report_status: 3, a_field: ['uid', 'text_rank', 'text_rank_category', 'o_client.text_first', 'o_client.text_last', 'o_rank_promotion_date.dtl_promotion_date'], a_row: [] } },
    ])
    const wl = new WlClient({ ...cfg, kidsCategory: "O'Brien Kids Belts" }, { fetchFn, sleep: noSleep })
    await wl.fetchKidsBeltRecords('100001', 'Ridgeline')
    const body = JSON.parse(String(calls[1].init?.body))
    expect(body.s_sql).toContain("text_rank_category = 'O''Brien Kids Belts'")
  })

  it('aborts mid-poll once the deadline passes, instead of finishing the report', async () => {
    const { fetchFn, calls } = fakeFetch([
      token,
      { json: { id_report_status: 2 } },
      { json: { id_report_status: 3, a_field: ['uid'], a_row: [['7']] } },
    ])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    await expect(wl.fetchKidsBeltRecords('1', 'X', Date.now() - 1)).rejects.toThrow('sync deadline exceeded')
    // Stopped after the first (still-queued) poll response and never reached the second,
    // completing one -- the deadline bounds the location itself, not just its start.
    expect(calls).toHaveLength(2)
  })

  it('checks the deadline before a retry backoff too, not only between polls', async () => {
    const { fetchFn } = fakeFetch([token, { status: 502, json: {} }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep, maxAttempts: 5 })
    await expect(wl.fetchKidsBeltRecords('1', 'X', Date.now() - 1)).rejects.toThrow('sync deadline exceeded')
  })

  it('refuses a page whose row count equals the limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => [String(i), 'Grey Belt', 'Kids', 'A', 'B', ''])
    const { fetchFn } = fakeFetch([token, { json: { id_report_status: 3, a_field: ['uid', 'text_rank', 'text_rank_category', 'o_client.text_first', 'o_client.text_last', 'o_rank_promotion_date.dtl_promotion_date'], a_row: rows } }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep, kidsLimit: 3 })
    await expect(wl.fetchKidsBeltRecords('1', 'X')).rejects.toThrow(/truncated/)
  })
})

describe('WlClient, a filtered search', () => {
  const FIELDS = ['uid', 'text_rank', 'text_rank_category', 'o_client.text_first', 'o_client.text_last', 'o_rank_promotion_date.dtl_promotion_date']
  const filter = { uids: ['w1'], lastTokens: ['martin'], firstTokens: [] }

  it('asks for the named subset and maps the rows it answers', async () => {
    const { fetchFn, calls } = fakeFetch([
      token,
      { json: { id_report_status: 3, a_field: FIELDS, a_row: [['w1', 'Grey Belt', 'Kids IBJJF Belts', 'Zoe', 'Martin', '2026-01-01']] } },
    ])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    const rows = await wl.searchKidsBeltRecords('100001', 'Ridgeline', filter)
    expect(rows).toEqual([{ uid: 'w1', kBusiness: '100001', location: 'Ridgeline', firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-01-01' }])
    const body = JSON.parse(String(calls[1].init?.body))
    expect(body.s_sql).toContain("and (uid in ('w1') or `o_client.text_last` like '%martin%')")
  })

  it('asks WellnessLiving nothing when the filter names nobody', async () => {
    const { fetchFn, calls } = fakeFetch([])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    expect(await wl.searchKidsBeltRecords('100001', 'Ridgeline', { uids: [], lastTokens: [], firstTokens: [] })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('keeps one record per uid across the queries of a split, at the later promotion', async () => {
    const { fetchFn, calls } = fakeFetch([
      token,
      { json: { id_report_status: 3, a_field: FIELDS, a_row: [['w1', 'Grey Belt', 'Kids IBJJF Belts', 'Zoe', 'Martin', '2026-01-01']] } },
      { json: { id_report_status: 3, a_field: FIELDS, a_row: [['w1', 'Grey/White Belt', 'Kids IBJJF Belts', 'Zoe', 'Martin', '2026-05-01'], ['w2', 'Yellow Belt', 'Kids IBJJF Belts', 'Ana', 'Bell', '2026-02-01']] } },
    ])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    const rows = await wl.searchKidsBeltRecords('100001', 'Ridgeline', { uids: [], lastTokens: Array.from({ length: 61 }, (_, i) => `token${i}`), firstTokens: [] })
    expect(calls).toHaveLength(3)
    expect(rows).toEqual([
      { uid: 'w1', kBusiness: '100001', location: 'Ridgeline', firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey/White Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-05-01' },
      { uid: 'w2', kBusiness: '100001', location: 'Ridgeline', firstName: 'Ana', lastName: 'Bell', rankTitle: 'Yellow Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-02-01' },
    ])
  })

  it('carries the deadline into the report it polls', async () => {
    const { fetchFn, calls } = fakeFetch([token, { json: { id_report_status: 2 } }, { json: { id_report_status: 3, a_field: FIELDS, a_row: [] } }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep })
    await expect(wl.searchKidsBeltRecords('100001', 'Ridgeline', filter, Date.now() - 1)).rejects.toThrow('sync deadline exceeded')
    expect(calls).toHaveLength(2)
  })

  it('refuses a filtered page whose row count equals the limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => [`w${i}`, 'Grey Belt', 'Kids IBJJF Belts', 'A', 'B', ''])
    const { fetchFn } = fakeFetch([token, { json: { id_report_status: 3, a_field: FIELDS, a_row: rows } }])
    const wl = new WlClient(cfg, { fetchFn, sleep: noSleep, kidsLimit: 3 })
    await expect(wl.searchKidsBeltRecords('100001', 'Ridgeline', filter)).rejects.toThrow(/truncated/)
  })
})
