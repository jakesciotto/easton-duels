import type { WlLike, WlLocation, WlBeltRecord } from './types.js'
import { KIDS_QUERY, normalizeTitle } from './belts.js'

const AUTH_URL = 'https://access.api.wellnessliving.io/oauth2/token'
const API_BASE = 'https://api.wellnessliving.io'
const BELTS_REPORT = 1619

export class WlRequestError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly body: unknown) {
    super(message)
    this.name = 'WlRequestError'
  }
}

export interface WlConfig { clientId: string; clientSecret: string; region: string; business: string }

export interface WlClientOptions {
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  maxPolls?: number
  maxAttempts?: number
  kidsLimit?: number
}

interface ReportResponse { id_report_status?: number; dtu_complete?: string; a_field?: string[]; a_row?: unknown[][] }

export class WlClient implements WlLike {
  private token: { value: string; expiresAt: number } | null = null
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly pollMs: number
  private readonly maxPolls: number
  private readonly maxAttempts: number
  private readonly kidsLimit: number

  constructor(private readonly cfg: WlConfig, opts: WlClientOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch
    this.sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
    this.pollMs = opts.pollMs ?? 2000
    this.maxPolls = opts.maxPolls ?? 60
    this.maxAttempts = opts.maxAttempts ?? 5
    this.kidsLimit = opts.kidsLimit ?? 10_000
  }

  async getToken(): Promise<string> {
    const now = Date.now()
    if (this.token && now < this.token.expiresAt) return this.token.value
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret })
    const res = await this.fetchFn(AUTH_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    if (!res.ok) throw new WlRequestError(`token request failed: ${res.status}`, res.status, null)
    const json = await res.json() as { access_token?: string; expires_in?: number }
    if (!json.access_token) throw new WlRequestError('token response missing access_token', res.status, json)
    this.token = { value: json.access_token, expiresAt: now + ((json.expires_in ?? 3600) - 60) * 1000 }
    return this.token.value
  }

  private url(path: string): string {
    const u = new URL(API_BASE + path)
    u.searchParams.set('id_region', this.cfg.region)
    u.searchParams.set('k_business', this.cfg.business)
    return u.toString()
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${await this.getToken()}` }
    const res = await this.fetchFn(this.url(path), { ...init, headers })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new WlRequestError(`${init.method ?? 'GET'} ${path} -> ${res.status}`, res.status, json)
    return json as T
  }

  async listLocations(): Promise<WlLocation[]> {
    const res = await this.request<{ a_location?: unknown }>('/v1/location/list', { method: 'GET' })
    const raw = res.a_location
    const rows: Record<string, unknown>[] = Array.isArray(raw)
      ? raw as Record<string, unknown>[]
      : Object.entries((raw ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => ({ k_location: k, ...v }))
    return rows
      .filter(l => l.k_business)
      .map(l => ({ kBusiness: String(l.k_business), title: String(l.s_title ?? l.text_title ?? '').trim(), city: String(l.text_city ?? '').trim() }))
  }

  // WL reports compute asynchronously: the first submit queues (status 2), later identical
  // submits return the cached result (status 3). Poll until complete; back off on 5xx.
  // i_offset paging is broken with s_sql, so this issues one page at the given limit.
  async queryReportPage(opts: { cidReport: number; kBusiness: string; limit: number; sSql?: string }): Promise<{ fields: string[]; rows: unknown[][] }> {
    const body: Record<string, unknown> = {
      k_business: opts.kBusiness, cid_report: opts.cidReport, i_limit: opts.limit, i_offset: 0,
      is_backend: 1, is_refresh: 0, s_sort: 'uid', json_filter: {},
    }
    if (opts.sSql !== undefined) body.s_sql = opts.sSql
    let delay = 2000
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        for (let poll = 0; poll < this.maxPolls; poll++) {
          const res = await this.request<ReportResponse>('/v1/report/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          if ((res.id_report_status ?? 0) >= 3 || res.dtu_complete) return { fields: res.a_field ?? [], rows: res.a_row ?? [] }
          await this.sleep(this.pollMs)
        }
        throw new WlRequestError(`report ${opts.cidReport} did not complete after ${this.maxPolls} polls`, null, null)
      } catch (err) {
        const retriable = err instanceof WlRequestError && err.status !== null && err.status >= 500
        if (!retriable || attempt === this.maxAttempts - 1) throw err
        await this.sleep(delay)
        delay *= 2
      }
    }
    throw new WlRequestError('report query exhausted retries', null, null)
  }

  async fetchKidsBeltRecords(kBusiness: string, location: string): Promise<WlBeltRecord[]> {
    const page = await this.queryReportPage({ cidReport: BELTS_REPORT, kBusiness, limit: this.kidsLimit, sSql: KIDS_QUERY })
    if (page.rows.length >= this.kidsLimit) {
      throw new WlRequestError(`${location} returned ${page.rows.length} rows, equal to the limit; the page may be truncated`, null, null)
    }
    const idx = Object.fromEntries(page.fields.map((f, i) => [f, i]))
    const cell = (row: unknown[], field: string): string => {
      const i = idx[field]
      return i === undefined ? '' : String(row[i] ?? '').trim()
    }
    return page.rows
      .map(row => ({
        uid: cell(row, 'uid'),
        kBusiness,
        location,
        firstName: cell(row, 'o_client.text_first'),
        lastName: cell(row, 'o_client.text_last'),
        rankTitle: normalizeTitle(cell(row, 'text_rank')),
        categoryTitle: normalizeTitle(cell(row, 'text_rank_category')),
        promotedAt: cell(row, 'o_rank_promotion_date.dtl_promotion_date') || null,
      }))
      .filter(r => r.uid !== '' && (r.firstName !== '' || r.lastName !== ''))
  }
}
