import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { deriveKidsBelt, kidsQuery } from '../src/roster/belts.js'
import { ageFromAgeGroup, weightFromWeightClass } from '../src/roster/parse.js'
import { makeCompetitorId } from '../src/roster/slug.js'
import { buildCandidates } from '../src/roster/join.js'
import { rosterFromEnv } from '../src/roster/config.js'
import { WlRequestError } from '../src/roster/wl.js'
import type { WlBeltRecord, LeaderboardCompetitor, WlLocation, WlNameFilter, RosterCandidate } from '../src/roster/types.js'
import { events, athletes, rosterCandidates } from '../src/db/schema.js'
import type { Db } from '../src/db/client.js'
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
    expect(c).toEqual({ wlUid: '1', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'North', leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'Female', promotedAt: '2026-01-01' })
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

const NORTH = { kBusiness: '100001', title: 'North', city: 'Northtown' }
const SOUTH = { kBusiness: '100002', title: 'South', city: 'Southtown' }

// Three children on the books, two at North and one at South, stored the way
// WellnessLiving stores a name: in title case, whatever case the roster types.
const GYM = [
  { uid: '9', firstName: 'Zoe', lastName: 'Martin', kBusiness: NORTH.kBusiness },
  { uid: '13', firstName: 'Iris', lastName: 'Delgado', kBusiness: NORTH.kBusiness },
  { uid: '11', firstName: 'Ana', lastName: 'Martin', kBusiness: SOUTH.kBusiness },
]

// What the report's own where clause asks for: a record answers when the filter names its
// uid, or one of the filter's tokens appears in one of its names. The name comparison
// lowers both sides, exactly as the query's lower() does, because WellnessLiving's own
// like is case sensitive and a bare column would answer nothing for a title case name.
const answers = (filter: WlNameFilter, r: WlBeltRecord) =>
  filter.uids.includes(r.uid)
  || filter.lastTokens.some(t => r.lastName.toLowerCase().includes(t.toLowerCase()))
  || filter.firstTokens.some(t => r.firstName.toLowerCase().includes(t.toLowerCase()))

function wlFake(locations: WlLocation[] = [NORTH], gym = GYM) {
  const searches: { location: string; filter: WlNameFilter }[] = []
  const at = (kBusiness: string, location: string): WlBeltRecord[] => gym
    .filter(kid => kid.kBusiness === kBusiness)
    .map(kid => ({ uid: kid.uid, kBusiness, location, firstName: kid.firstName, lastName: kid.lastName, rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: null }))
  return {
    searches,
    async listLocations() { return locations },
    async fetchKidsBeltRecords(kBusiness: string, location: string) { return at(kBusiness, location) },
    async searchKidsBeltRecords(kBusiness: string, location: string, filter: WlNameFilter) {
      searches.push({ location, filter })
      return at(kBusiness, location).filter(r => answers(filter, r))
    },
  }
}

const addZoe = (db: Db, eventId: number) =>
  db.insert(athletes).values({ eventId, firstName: 'Zoe', lastName: 'Martin', source: 'manual' }).run()

describe('roster routes', () => {
  it('503s when WL is not configured', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    expect(r.status).toBe(503)
    expect(r.body.error.code).toBe('wl_not_configured')
  })

  it('asks every location for the roster by uid and by last name, with no body', async () => {
    const wl = wlFake([NORTH, SOUTH])
    const { app, db, adminToken } = await createTestApp({ roster: { wl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })
    await db.update(athletes).set({ wlUid: 'w5' }).where(eq(athletes.id, s.a2)).run()

    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)

    expect(r.status).toBe(200)
    expect(wl.searches.map(x => x.location)).toEqual(['North', 'South'])
    expect(wl.searches[0].filter.uids).toEqual(['w5'])
    expect([...wl.searches[0].filter.lastTokens].sort()).toEqual(['kim', 'park', 'rivera', 'tran'])
    expect(wl.searches[0].filter.firstTokens).toEqual([])
    expect(wl.searches[1].filter).toEqual(wl.searches[0].filter)
  })

  it('brings back the children the roster names and nobody else, and warns that the leaderboard is off', async () => {
    const wl = wlFake([NORTH, SOUTH])
    const { app, db, adminToken } = await createTestApp({ roster: { wl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })

    const none = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    expect(none.status).toBe(200)
    expect(none.body.candidates).toEqual([])
    expect(none.body.warnings[0]).toMatch(/not configured/)

    await addZoe(db, s.eventId)
    const found = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    expect(found.body.candidates.map((c: RosterCandidate) => c.wlLocation).sort()).toEqual(['North', 'South'])
    expect(found.body.candidates.find((c: RosterCandidate) => c.wlUid === '9')).toMatchObject({ firstName: 'Zoe', belt: 'grey', wlLocation: 'North', erp: null })
    expect(found.body.report.linked).toEqual(['Zoe Martin'])
  })

  it('finds a child whose name the roster typed in another case', async () => {
    const wl = wlFake()
    const { app, db, adminToken } = await createTestApp({ roster: { wl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values({ eventId: s.eventId, firstName: 'Iris', lastName: 'DELGADO', source: 'manual' }).run()

    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)

    expect(wl.searches[0].filter.lastTokens).toContain('delgado')
    expect(r.body.candidates.map((c: RosterCandidate) => c.wlUid)).toEqual(['13'])
    expect(r.body.report.linked).toEqual(['Iris DELGADO'])
  })

  it('ignores a body, and never writes the location column any more', async () => {
    const wl = wlFake()
    const { app, db, adminToken } = await createTestApp({ roster: { wl, leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })
    await addZoe(db, s.eventId)

    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['999'] }, adminToken)

    expect(r.status).toBe(200)
    expect(wl.searches.map(x => x.location)).toEqual(['North'])
    const detail = await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)
    expect(detail.body.event.wlLocations).toBeNull()
  })

  it('gives up mid-location once the sync budget is spent, not only between locations', async () => {
    // Real start point: the admin token's expiry is checked against this same clock.
    const clock = { ms: Date.now() }
    const slowWl = {
      async listLocations() {
        return ['100001', '100002', '100003'].map((kBusiness, i) => ({ kBusiness, title: `Site ${i + 1}`, city: 'Northtown' }))
      },
      async fetchKidsBeltRecords() { return [] },
      // Mirrors the real WlClient: several sleeps inside one location's own search, each
      // one checking the deadline the route passed down, rather than one lump sum that
      // only the between-locations check could ever catch.
      async searchKidsBeltRecords(kBusiness: string, location: string, _filter: WlNameFilter, deadlineMs?: number) {
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
      const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
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

  it('replaces the cached pool on every sync instead of accumulating it', async () => {
    const { app, db, adminToken } = await createTestApp({ roster: { wl: wlFake(), leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db)
    await addZoe(db, s.eventId)
    await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    let rows = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ wlUid: '9', belt: 'grey' })
    // A second sync that finds nobody replaces the first, it does not add to it.
    const { app: app2 } = await createTestApp({ db, roster: { wl: wlFake([NORTH], []), leaderboard: null, syncBudgetMs: null } })
    await call(app2, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    rows = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()
    expect(rows).toHaveLength(0)
  })

  it('serves the cached pool as RosterCandidate[] and drops it when the event is deleted', async () => {
    const { app, db, adminToken } = await createTestApp({ roster: { wl: wlFake(), leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })
    await addZoe(db, s.eventId)
    await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/candidates`, undefined, adminToken)
    expect(r.status).toBe(200)
    expect(r.body).toEqual([{ wlUid: '9', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'North', leaderboardId: null, erp: null, age: null, weightLbs: null, gender: null, promotedAt: null }])
    expect((await call(app, 'GET', '/api/events/999999/candidates', undefined, adminToken)).status).toBe(404)
    await db.delete(events).where(eq(events.id, s.eventId)).run()
    expect(await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()).toEqual([])
  })

  it('carries the sync report on the sync response', async () => {
    const { app, db, adminToken } = await createTestApp({ roster: { wl: wlFake(), leaderboard: null, syncBudgetMs: null } })
    const s = await seedEvent(db, { matches: 0 })
    await addZoe(db, s.eventId)
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, undefined, adminToken)
    expect(r.status).toBe(200)
    expect(r.body.report.linked).toEqual(['Zoe Martin'])
    expect(r.body.report.refreshed).toBe(0)
  })

  it('404s an unknown event before it asks WellnessLiving anything', async () => {
    const wl = wlFake()
    const { app, adminToken } = await createTestApp({ roster: { wl, leaderboard: null, syncBudgetMs: null } })
    const r = await call(app, 'POST', '/api/events/999999/roster/sync', undefined, adminToken)
    expect(r.status).toBe(404)
    expect(wl.searches).toEqual([])
  })
})

describe('the WellnessLiving search', () => {
  const wlConfig = (wl: ReturnType<typeof wlFake>) => ({ roster: { wl, leaderboard: null, syncBudgetMs: null } })

  it('asks for one letter more than the field does, and says so in the field\'s own words', async () => {
    const { app, db, adminToken } = await createTestApp(wlConfig(wlFake()))
    const s = await seedEvent(db, { matches: 0 })
    for (const q of ['', '%20a%20']) {
      const r = await call(app, 'GET', `/api/events/${s.eventId}/wl-search?q=${q}`, undefined, adminToken)
      expect(r.status).toBe(422)
      expect(r.body.error.code).toBe('validation')
      expect(r.body.error.message).toBe('Type at least two letters.')
    }
  })

  it('searches every location by first and last name, orders by score, and stores nothing', async () => {
    const wl = wlFake([NORTH, SOUTH])
    const { app, db, adminToken } = await createTestApp(wlConfig(wl))
    const s = await seedEvent(db, { matches: 0 })

    const r = await call(app, 'GET', `/api/events/${s.eventId}/wl-search?q=zoe%20martin`, undefined, adminToken)

    expect(r.status).toBe(200)
    expect(wl.searches.map(x => x.location)).toEqual(['North', 'South'])
    expect(wl.searches[0].filter).toEqual({ uids: [], lastTokens: ['zoe', 'martin'], firstTokens: ['zoe', 'martin'] })
    expect(r.body.map((c: RosterCandidate) => c.wlUid)).toEqual(['9', '11'])
    expect(r.body[0]).toMatchObject({ firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'North' })
    expect(await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()).toEqual([])
  })

  it('searches a two letter query as itself, since no part of it is longer', async () => {
    const wl = wlFake([NORTH, SOUTH])
    const { app, db, adminToken } = await createTestApp(wlConfig(wl))
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'GET', `/api/events/${s.eventId}/wl-search?q=zo`, undefined, adminToken)
    expect(r.status).toBe(200)
    expect(wl.searches[0].filter).toEqual({ uids: [], lastTokens: ['zo'], firstTokens: ['zo'] })
    expect(r.body.map((c: RosterCandidate) => c.wlUid)).toEqual(['9'])
  })

  it('503s when WellnessLiving is not configured, and 404s an unknown event', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const off = await call(app, 'GET', `/api/events/${s.eventId}/wl-search?q=martin`, undefined, adminToken)
    expect(off.status).toBe(503)
    expect(off.body.error.code).toBe('wl_not_configured')
    expect((await call(app, 'GET', '/api/events/999999/wl-search?q=martin', undefined, adminToken)).status).toBe(404)
  })

  it('needs an admin token', async () => {
    const { app, db } = await createTestApp(wlConfig(wlFake()))
    const s = await seedEvent(db, { matches: 0 })
    expect((await call(app, 'GET', `/api/events/${s.eventId}/wl-search?q=martin`)).status).toBe(401)
  })
})

describe('roster match route', () => {
  it('404s on an unknown event', async () => {
    const { app, adminToken } = await createTestApp()
    expect((await call(app, 'POST', '/api/events/999999/roster/match', undefined, adminToken)).status).toBe(404)
  })

  it('409s no_pool on an empty pool', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/match`, undefined, adminToken)
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('no_pool')
  })

  it('links the pool and answers the report plus the athletes', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(athletes).values({ eventId: s.eventId, firstName: 'Jonas', lastName: 'Blake', source: 'manual' }).run()
    await db.insert(rosterCandidates).values({ eventId: s.eventId, wlUid: 'w0', firstName: 'Jonas', lastName: 'Blake', belt: 'yellow', wlLocation: 'North' }).run()
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/match`, undefined, adminToken)
    expect(r.status).toBe(200)
    expect(r.body.report.linked).toEqual(['Jonas Blake'])
    expect(r.body.athletes.find((a: any) => a.lastName === 'Blake')).toMatchObject({ wlUid: 'w0', belt: 'yellow' })
  })
})
