import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { fetchCompetitors } from '../roster/leaderboard.js'
import { buildCandidates } from '../roster/join.js'
import type { WlBeltRecord, LeaderboardCompetitor } from '../roster/types.js'

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
  try {
    const byK = new Map((await roster.wl.listLocations()).map(l => [l.kBusiness, l]))
    for (const k of kBusinesses) {
      const loc = byK.get(k)
      if (!loc) return errorJson(c, 422, 'validation', `unknown location ${k}`)
      records.push(...await roster.wl.fetchKidsBeltRecords(k, loc.title))
    }
  } catch (e) {
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
  return c.json({ candidates: buildCandidates(records, competitors), warnings })
})
