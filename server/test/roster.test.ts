import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { deriveKidsBelt, kidsQuery } from '../src/roster/belts.js'
import { ageFromAgeGroup, weightFromWeightClass } from '../src/roster/parse.js'
import { makeCompetitorId } from '../src/roster/slug.js'
import { buildCandidates } from '../src/roster/join.js'
import { rosterFromEnv } from '../src/roster/config.js'
import { WlRequestError } from '../src/roster/wl.js'
import type { WlBeltRecord, LeaderboardCompetitor } from '../src/roster/types.js'
import { events, rosterCandidates } from '../src/db/schema.js'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'

describe('deriveKidsBelt', () => {
  it('maps WL rank titles to the kids ladder', () => {
    expect(deriveKidsBelt('Grey/White Belt')).toBe('grey-white')
    expect(deriveKidsBelt('Gray Belt - 2 stripes')).toBe('grey')
    expect(deriveKidsBelt('Yellow/Black belt')).toBe('yellow-black')
    expect(deriveKidsBelt('White Belt')).toBe('white')
    expect(deriveKidsBelt('Blue Belt')).toBeNull()
    expect(deriveKidsBelt('')).toBeNull()
  })
  it('keeps the default query lowercase and narrowed to kids IBJJF categories', () => {
    const q = kidsQuery()
    expect(q.startsWith('select ')).toBe(true)
    expect(q).toContain("like '%Kids%'")
    expect(q).toContain("like '%IBJJF%'")
  })
  it('overrides with an exact category title, escaping an embedded quote', () => {
    const q = kidsQuery("O'Brien Kids Belts")
    expect(q).toContain("text_rank_category = 'O''Brien Kids Belts'")
    expect(q).not.toContain('%Kids%')
  })
})

describe('parse', () => {
  it('reads the lower bound of an age group', () => {
    expect(ageFromAgeGroup('8-9')).toBe(8)
    expect(ageFromAgeGroup('10-10')).toBe(10)
    expect(ageFromAgeGroup('Adult')).toBeNull()
    expect(ageFromAgeGroup(null)).toBeNull()
  })
  it('reads the bound of a weight class in lbs or kg', () => {
    expect(weightFromWeightClass('-75 lbs')).toBe(75)
    expect(weightFromWeightClass('75+ lbs')).toBe(75)
    expect(weightFromWeightClass('-30 kg')).toBe(66)
    expect(weightFromWeightClass('Open')).toBeNull()
  })
})

describe('makeCompetitorId', () => {
  it('matches the leaderboard slug rule byte for byte', () => {
    expect(makeCompetitorId('Vesper Ortega')).toBe('vesper-ortega')
    expect(makeCompetitorId("  Mateo  O'Neil ")).toBe('mateo-o-neil')
  })
})

describe('buildCandidates', () => {
  const rec = (o: Partial<WlBeltRecord>): WlBeltRecord => ({
    uid: '1', kBusiness: '100001', location: 'North', firstName: 'Zoe', lastName: 'Martin',
    rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-01-01', ...o,
  })
  const comp: LeaderboardCompetitor = { id: 'zoe-martin', name: 'Zoe Martin', belt: 'grey', ageGroup: '8-9', gender: 'Female', weightClass: '-60 lbs', academy: 'Ridgeline', erp: 5.2 }

  it('joins by slug and fills age, weight, gender, and erp', () => {
    const [c] = buildCandidates([rec({})], [comp])
    expect(c).toEqual({ wlUid: '1', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'North', leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'Female' })
  })
  it('keeps one row per uid using the latest promotion', () => {
    const rows = buildCandidates([rec({ rankTitle: 'Grey/White Belt', promotedAt: '2025-01-01' }), rec({ location: 'South', promotedAt: '2026-05-01' })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ belt: 'grey', wlLocation: 'South', leaderboardId: null, erp: null, age: null })
  })
  it('sorts by last name then first name', () => {
    const rows = buildCandidates([rec({ uid: '2', firstName: 'Ana', lastName: 'Bell' }), rec({ uid: '1' })], [])
    expect(rows.map(r => r.lastName)).toEqual(['Bell', 'Martin'])
  })
})

describe('rosterFromEnv', () => {
  it('builds clients only when every variable is present', () => {
    expect(rosterFromEnv({})).toEqual({ wl: null, leaderboard: null, syncBudgetMs: null })
    const full = rosterFromEnv({ WL_CLIENT_ID: 'a', WL_CLIENT_SECRET: 'b', WL_BUSINESS: '1', LEADERBOARD_SUPABASE_URL: 'https://x.supabase.co', LEADERBOARD_SUPABASE_KEY: 'k' })
    expect(full.wl).not.toBeNull()
    expect(full.leaderboard).toEqual({ url: 'https://x.supabase.co', key: 'k' })
  })

  it('takes the sync budget from the environment, then from the caller default', () => {
    expect(rosterFromEnv({ SYNC_DEADLINE_MS: '90000' }, { syncBudgetMs: 280_000 }).syncBudgetMs).toBe(90_000)
    expect(rosterFromEnv({}, { syncBudgetMs: 280_000 }).syncBudgetMs).toBe(280_000)
    expect(rosterFromEnv({ SYNC_DEADLINE_MS: 'soon' }, { syncBudgetMs: 280_000 }).syncBudgetMs).toBe(280_000)
    expect(rosterFromEnv({ SYNC_DEADLINE_MS: '0' }).syncBudgetMs).toBeNull()
  })
})

describe('roster routes', () => {
  const fakeWl = {
    async listLocations() { return [{ kBusiness: '100001', title: 'North', city: 'Northtown' }] },
    async fetchKidsBeltRecords(kBusiness: string, location: string) {
      return [{ uid: '9', kBusiness, location, firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: null }]
    },
  }

  it('503s when WL is not configured', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/wl-locations`, undefined, adminToken)
    expect(r.status).toBe(503)
    expect(r.body.error.code).toBe('wl_not_configured')
  })

  it('returns candidates and a warning when the leaderboard is off', async () => {
    const { app, db, adminToken } = await createTestApp({ roster: { wl: fakeWl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db)
    const locs = await call(app, 'GET', `/api/events/${s.eventId}/wl-locations`, undefined, adminToken)
    expect(locs.body[0].kBusiness).toBe('100001')
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001'] }, adminToken)
    expect(r.status).toBe(200)
    expect(r.body.candidates[0]).toMatchObject({ wlUid: '9', belt: 'grey', wlLocation: 'North', erp: null })
    expect(r.body.warnings[0]).toMatch(/not configured/)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['1'] }, adminToken)).status).toBe(422)
  })

  it('gives up mid-location once the sync budget is spent, not only between locations', async () => {
    // Real start point: the admin token's expiry is checked against this same clock.
    const clock = { ms: Date.now() }
    const slowWl = {
      async listLocations() {
        return ['100001', '100002', '100003'].map((kBusiness, i) => ({ kBusiness, title: `Site ${i + 1}`, city: 'Northtown' }))
      },
      // Mirrors the real WlClient: several sleeps inside one location's own fetch, each
      // one checking the deadline the route passed down, rather than one lump sum that
      // only the between-locations check could ever catch.
      async fetchKidsBeltRecords(kBusiness: string, location: string, deadlineMs?: number) {
        const polls = kBusiness === '100001' ? 2 : 4
        for (let poll = 0; poll < polls; poll++) {
          clock.ms += 70_000
          if (deadlineMs !== undefined && clock.ms > deadlineMs) throw new WlRequestError('sync deadline exceeded', null, null)
        }
        return [{ uid: kBusiness, kBusiness, location, firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: null }]
      },
    }
    const { app, db, adminToken } = await createTestApp({ roster: { wl: slowWl, leaderboard: null, syncBudgetMs: 300_000 } })
    const s = await seedEvent(db)
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock.ms)
    const start = clock.ms
    try {
      const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001', '100002', '100003'] }, adminToken)
      expect(r.status).toBe(503)
      expect(r.body.error.code).toBe('wl_error')
      // Location 1 completes (140_000ms) and passes the between-locations check at 300_000ms.
      // Location 2 needs 280_000ms to run to completion (420_000ms total) but is aborted at
      // its third poll -- 350_000ms in, well before it would ever return and well before a
      // location 3 would even start.
      expect(r.body.error.message).toContain('1 of 3 locations')
      expect(clock.ms - start).toBe(350_000)
    } finally {
      spy.mockRestore()
    }
  })

  it('syncs every location when no budget is set', async () => {
    const slowWl = {
      async listLocations() {
        return ['100001', '100002'].map((kBusiness, i) => ({ kBusiness, title: `Site ${i + 1}`, city: 'Northtown' }))
      },
      async fetchKidsBeltRecords(kBusiness: string, location: string) {
        return [{ uid: kBusiness, kBusiness, location, firstName: 'Zoe', lastName: `Martin${kBusiness}`, rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: null }]
      },
    }
    const { app, db, adminToken } = await createTestApp({ roster: { wl: slowWl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db)
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001', '100002'] }, adminToken)
    expect(r.status).toBe(200)
    expect(r.body.candidates).toHaveLength(2)
  })

  it('replaces the cached pool on every sync instead of accumulating it, and never bumps the event version', async () => {
    const { app, db, adminToken } = await createTestApp({ roster: { wl: fakeWl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db)
    const before = (await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.version
    await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001'] }, adminToken)
    let rows = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ wlUid: '9', belt: 'grey' })
    // A second sync with a different pull result replaces the first, it does not add to it.
    const shrunkWl = { ...fakeWl, async fetchKidsBeltRecords() { return [] } }
    const { app: app2 } = await createTestApp({ db, roster: { wl: shrunkWl, leaderboard: null, syncBudgetMs: null } })
    await call(app2, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001'] }, adminToken)
    rows = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()
    expect(rows).toHaveLength(0)
    const after = (await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.version
    expect(after).toBe(before)
  })

  it('serves the cached pool as RosterCandidate[] and drops it when the event is deleted', async () => {
    const { app, db, adminToken } = await createTestApp({ roster: { wl: fakeWl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })
    await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001'] }, adminToken)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/candidates`, undefined, adminToken)
    expect(r.status).toBe(200)
    expect(r.body).toEqual([{ wlUid: '9', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'North', leaderboardId: null, erp: null, age: null, weightLbs: null, gender: null }])
    expect((await call(app, 'GET', '/api/events/999999/candidates', undefined, adminToken)).status).toBe(404)
    await db.delete(events).where(eq(events.id, s.eventId)).run()
    expect(await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()).toEqual([])
  })
})
