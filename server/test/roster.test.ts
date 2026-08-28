import { describe, it, expect } from 'vitest'
import { deriveKidsBelt, KIDS_QUERY } from '../src/roster/belts.js'
import { ageFromAgeGroup, weightFromWeightClass } from '../src/roster/parse.js'
import { makeCompetitorId } from '../src/roster/slug.js'
import { buildCandidates } from '../src/roster/join.js'
import { rosterFromEnv } from '../src/roster/config.js'
import type { WlBeltRecord, LeaderboardCompetitor } from '../src/roster/types.js'
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
  it('keeps the query lowercase and kids-only', () => {
    expect(KIDS_QUERY.startsWith('select ')).toBe(true)
    expect(KIDS_QUERY).toContain("like '%Kids%'")
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
    uid: '1', kBusiness: '100001', location: 'Boulder', firstName: 'Zoe', lastName: 'Martin',
    rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: '2026-01-01', ...o,
  })
  const comp: LeaderboardCompetitor = { id: 'zoe-martin', name: 'Zoe Martin', belt: 'grey', ageGroup: '8-9', gender: 'Female', weightClass: '-60 lbs', academy: 'Boulder', erp: 5.2 }

  it('joins by slug and fills age, weight, gender, and erp', () => {
    const [c] = buildCandidates([rec({})], [comp])
    expect(c).toEqual({ wlUid: '1', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Boulder', leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'Female' })
  })
  it('keeps one row per uid using the latest promotion', () => {
    const rows = buildCandidates([rec({ rankTitle: 'Grey/White Belt', promotedAt: '2025-01-01' }), rec({ location: 'Denver', promotedAt: '2026-05-01' })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ belt: 'grey', wlLocation: 'Denver', leaderboardId: null, erp: null, age: null })
  })
  it('sorts by last name then first name', () => {
    const rows = buildCandidates([rec({ uid: '2', firstName: 'Ana', lastName: 'Bell' }), rec({ uid: '1' })], [])
    expect(rows.map(r => r.lastName)).toEqual(['Bell', 'Martin'])
  })
})

describe('rosterFromEnv', () => {
  it('builds clients only when every variable is present', () => {
    expect(rosterFromEnv({})).toEqual({ wl: null, leaderboard: null })
    const full = rosterFromEnv({ WL_CLIENT_ID: 'a', WL_CLIENT_SECRET: 'b', WL_BUSINESS: '1', LEADERBOARD_SUPABASE_URL: 'https://x.supabase.co', LEADERBOARD_SUPABASE_KEY: 'k' })
    expect(full.wl).not.toBeNull()
    expect(full.leaderboard).toEqual({ url: 'https://x.supabase.co', key: 'k' })
  })
})

describe('roster routes', () => {
  const fakeWl = {
    async listLocations() { return [{ kBusiness: '100001', title: 'Boulder', city: 'Boulder' }] },
    async fetchKidsBeltRecords(kBusiness: string, location: string) {
      return [{ uid: '9', kBusiness, location, firstName: 'Zoe', lastName: 'Martin', rankTitle: 'Grey Belt', categoryTitle: 'Kids IBJJF Belts', promotedAt: null }]
    },
  }

  it('503s when WL is not configured', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/wl-locations`, undefined, adminToken)
    expect(r.status).toBe(503)
    expect(r.body.error.code).toBe('wl_not_configured')
  })

  it('returns candidates and a warning when the leaderboard is off', async () => {
    const { app, db, adminToken } = createTestApp({ roster: { wl: fakeWl, leaderboard: null } })
    const s = seedEvent(db)
    const locs = await call(app, 'GET', `/api/events/${s.eventId}/wl-locations`, undefined, adminToken)
    expect(locs.body[0].kBusiness).toBe('100001')
    const r = await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['100001'] }, adminToken)
    expect(r.status).toBe(200)
    expect(r.body.candidates[0]).toMatchObject({ wlUid: '9', belt: 'grey', wlLocation: 'Boulder', erp: null })
    expect(r.body.warnings[0]).toMatch(/not configured/)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/roster/sync`, { kBusinesses: ['1'] }, adminToken)).status).toBe(422)
  })
})
