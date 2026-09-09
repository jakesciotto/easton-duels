import { Hono } from 'hono'
import { z } from 'zod'
import { asc, count, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, athletes, rosterCandidates } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { fetchCompetitors } from '../roster/leaderboard.js'
import { buildCandidates } from '../roster/join.js'
import { syncRoster } from '../roster/sync.js'
import { WlRequestError } from '../roster/wl.js'
import { assertNotCertified } from '../audit/certify.js'
import type { WlBeltRecord, LeaderboardCompetitor, RosterCandidate } from '../roster/types.js'

export const rosterRoutes = new Hono<Env>()

rosterRoutes.get('/events/:eventId/wl-locations', requireAdmin, async c => {
  const { roster } = c.get('ctx')
  if (!roster.wl) return errorJson(c, 503, 'wl_not_configured', 'WellnessLiving credentials are not set')
  try {
    return c.json(await roster.wl.listLocations())
  } catch (e) {
    return errorJson(c, 503, 'wl_error', e instanceof Error ? e.message : 'WellnessLiving request failed')
  }
})

rosterRoutes.post('/events/:eventId/roster/sync', requireAdmin, validate('json', z.object({ kBusinesses: z.array(z.string().min(1)).min(1).max(20) })), async c => {
  const { db, roster } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  await assertNotCertified(db, eventId)
  if (!roster.wl) return errorJson(c, 503, 'wl_not_configured', 'WellnessLiving credentials are not set')
  const { kBusinesses } = c.req.valid('json')
  const warnings: string[] = []
  const records: WlBeltRecord[] = []
  // One report per location, each of which can poll for minutes. Without an overall budget
  // a multi-location sync outlives the function's time limit and the admin dialog sees a
  // platform timeout instead of an envelope it can render. The same absolute deadline is
  // handed to every location's own fetch, so a report that is still polling when the budget
  // runs out gives up mid-flight instead of only being caught once it returns.
  const deadline = roster.syncBudgetMs === null ? null : Date.now() + roster.syncBudgetMs
  const outOfTime = (done: number) => `roster sync ran out of time after ${done} of ${kBusinesses.length} locations; sync fewer at once`
  let done = 0
  try {
    const byK = new Map((await roster.wl.listLocations()).map(l => [l.kBusiness, l]))
    for (const k of kBusinesses) {
      const loc = byK.get(k)
      if (!loc) return errorJson(c, 422, 'validation', `unknown location ${k}`)
      if (deadline !== null && Date.now() > deadline) return errorJson(c, 503, 'wl_error', outOfTime(done))
      records.push(...await roster.wl.fetchKidsBeltRecords(k, loc.title, deadline ?? undefined))
      done += 1
    }
  } catch (e) {
    if (e instanceof WlRequestError && e.message === 'sync deadline exceeded') return errorJson(c, 503, 'wl_error', outOfTime(done))
    return errorJson(c, 503, 'wl_error', e instanceof Error ? e.message : 'WellnessLiving request failed')
  }
  let competitors: LeaderboardCompetitor[] = []
  if (roster.leaderboard) {
    try {
      const r = await fetchCompetitors(roster.leaderboard)
      competitors = r.competitors
      if (!r.hasErp) warnings.push('The leaderboard has no erp column yet. The matcher uses belt, age, and weight.')
    } catch (e) {
      warnings.push(`Leaderboard join skipped: ${e instanceof Error ? e.message : 'request failed'}`)
    }
  } else {
    warnings.push('Leaderboard not configured. No ERP join.')
  }
  // The engine replaces the pool from the same records, so this build is only the copy the
  // dialog lists. The pool is a cache of the last pull, not append-only history: a
  // competitor who left WellnessLiving drops out of it.
  const candidates = buildCandidates(records, competitors)
  const report = await db.transaction(tx => syncRoster(tx, eventId, records, competitors, { locations: kBusinesses.length, warnings: warnings.length }))
  return c.json({ candidates, warnings, report })
})

rosterRoutes.post('/events/:eventId/roster/match', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  await assertNotCertified(db, eventId)
  const pool = await db.select({ n: count() }).from(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).get()
  if (!pool || pool.n === 0) return errorJson(c, 409, 'no_pool', 'Import from WellnessLiving first.')
  const report = await db.transaction(tx => syncRoster(tx, eventId, null, []))
  const athleteRows = await db.select().from(athletes).where(eq(athletes.eventId, eventId)).orderBy(asc(athletes.lastName), asc(athletes.firstName)).all()
  return c.json({ report, athletes: athleteRows })
})

rosterRoutes.get('/events/:eventId/candidates', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  const rows = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).orderBy(asc(rosterCandidates.lastName), asc(rosterCandidates.firstName)).all()
  const body: RosterCandidate[] = rows.map(r => ({
    wlUid: r.wlUid, firstName: r.firstName, lastName: r.lastName, belt: r.belt, wlLocation: r.wlLocation ?? '',
    leaderboardId: r.leaderboardId, erp: r.erp, age: r.age, weightLbs: r.weightLbs, gender: r.gender, promotedAt: r.promotedAt,
  }))
  return c.json(body)
})
