import { Hono } from 'hono'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, rosterCandidates } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { fetchCompetitors } from '../roster/leaderboard.js'
import { buildCandidates } from '../roster/join.js'
import { WlRequestError } from '../roster/wl.js'
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
  const candidates = buildCandidates(records, competitors)
  // The pool is a cache of the last import, not append-only history: each sync replaces
  // it wholesale so a competitor who left WL (or was mis-ranked) drops out too. Candidates
  // are admin-only data outside the live snapshot, so this never bumps the event version.
  await db.transaction(async tx => {
    await tx.delete(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).run()
    if (candidates.length > 0) await tx.insert(rosterCandidates).values(candidates.map(cand => ({ eventId, ...cand }))).run()
  })
  return c.json({ candidates, warnings })
})

rosterRoutes.get('/events/:eventId/candidates', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  const rows = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).orderBy(asc(rosterCandidates.lastName), asc(rosterCandidates.firstName)).all()
  const body: RosterCandidate[] = rows.map(r => ({
    wlUid: r.wlUid, firstName: r.firstName, lastName: r.lastName, belt: r.belt, wlLocation: r.wlLocation ?? '',
    leaderboardId: r.leaderboardId, erp: r.erp, age: r.age, weightLbs: r.weightLbs, gender: r.gender,
  }))
  return c.json(body)
})
