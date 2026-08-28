import type { LeaderboardConfig, LeaderboardCompetitor } from './types.js'

const PAGE = 1000
const BASE_COLUMNS = 'id,name,belt,age_group,gender,weight_class,academy'

const nullStr = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export async function fetchCompetitors(cfg: LeaderboardConfig, fetchFn: typeof fetch = fetch): Promise<{ competitors: LeaderboardCompetitor[]; hasErp: boolean }> {
  const base = cfg.url.replace(/\/$/, '')
  let hasErp = true
  const out: LeaderboardCompetitor[] = []
  let from = 0
  while (true) {
    const columns = hasErp ? `${BASE_COLUMNS},erp` : BASE_COLUMNS
    const url = `${base}/rest/v1/competitors?select=${columns}&age_division=eq.kids&order=id.asc`
    const res = await fetchFn(url, { headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}`, range: `${from}-${from + PAGE - 1}` } })
    if (res.status === 400 && hasErp) {
      const body = await res.json().catch(() => null) as { code?: string } | null
      if (body?.code === '42703') {
        hasErp = false
        continue
      }
      throw new Error(`leaderboard query failed: 400 ${JSON.stringify(body)}`)
    }
    if (!res.ok) throw new Error(`leaderboard query failed: ${res.status}`)
    const rows = await res.json() as Record<string, unknown>[]
    for (const r of rows) {
      out.push({
        id: String(r.id), name: String(r.name ?? ''), belt: nullStr(r.belt), ageGroup: nullStr(r.age_group), gender: nullStr(r.gender),
        weightClass: nullStr(r.weight_class), academy: nullStr(r.academy), erp: typeof r.erp === 'number' ? r.erp : null,
      })
    }
    if (rows.length < PAGE) break
    from += PAGE
  }
  return { competitors: out, hasErp }
}
