import { Hono } from 'hono'
import { asc, count, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, athletes, rosterCandidates } from '../db/schema.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { fetchCompetitors } from '../roster/leaderboard.js'
import { buildCandidates } from '../roster/join.js'
import { syncRoster } from '../roster/sync.js'
import { WlRequestError } from '../roster/wl.js'
import { nameTokens } from '../shared/similarity.js'
import { assertNotCertified } from '../audit/certify.js'
import type { WlBeltRecord, WlLike, WlNameFilter, LeaderboardCompetitor, RosterCandidate } from '../roster/types.js'

export const rosterRoutes = new Hono<Env>()

type Sweep = { ok: true; records: WlBeltRecord[]; locations: number } | { ok: false; message: string }

/**
 * One filtered report per location, every location. Each can poll for minutes, so without
 * an overall budget a sweep outlives the function's time limit and the dialog sees a
 * platform timeout instead of an envelope it can render. The same absolute deadline is
 * handed to every location's own search, so a report that is still polling when the budget
 * runs out gives up mid-flight instead of only being caught once it returns.
 */
async function sweepLocations(wl: WlLike, filter: WlNameFilter, budgetMs: number | null): Promise<Sweep> {
  const deadline = budgetMs === null ? null : Date.now() + budgetMs
  const records: WlBeltRecord[] = []
  let locations = 0
  let done = 0
  const outOfTime = () => `ran out of time after ${done} of ${locations} locations; try again`
  try {
    const all = await wl.listLocations()
    locations = all.length
    for (const loc of all) {
      if (deadline !== null && Date.now() > deadline) return { ok: false, message: outOfTime() }
      records.push(...await wl.searchKidsBeltRecords(loc.kBusiness, loc.title, filter, deadline ?? undefined))
      done += 1
    }
  } catch (e) {
    if (e instanceof WlRequestError && e.message === 'sync deadline exceeded') return { ok: false, message: outOfTime() }
    return { ok: false, message: e instanceof Error ? e.message : 'WellnessLiving request failed' }
  }
  return { ok: true, records, locations }
}

/**
 * Who the sync looks for: the uid of every row already linked, and the last name of every
 * row, linked ones too, so a child whose uid has gone can surface as a near match again.
 * A first name would only widen what the last name already asks for.
 */
function rosterFilter(rows: { wlUid: string | null; lastName: string }[]): WlNameFilter {
  const uids = new Set<string>()
  const lastTokens = new Set<string>()
  for (const row of rows) {
    if (row.wlUid !== null) uids.add(row.wlUid)
    for (const token of nameTokens(row.lastName)) lastTokens.add(token)
  }
  return { uids: [...uids], lastTokens: [...lastTokens], firstTokens: [] }
}

rosterRoutes.post('/events/:eventId/roster/sync', requireAdmin, async c => {
  const { db, roster } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  await assertNotCertified(db, eventId)
  if (!roster.wl) return errorJson(c, 503, 'wl_not_configured', 'WellnessLiving credentials are not set')

  const rows = await db.select({ wlUid: athletes.wlUid, lastName: athletes.lastName }).from(athletes).where(eq(athletes.eventId, eventId)).all()
  const found = await sweepLocations(roster.wl, rosterFilter(rows), roster.syncBudgetMs)
  if (!found.ok) return errorJson(c, 503, 'wl_error', found.message)

  const warnings: string[] = []
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
  // dialog lists. The pool is the subset the last sync found, not append-only history: a
  // competitor WellnessLiving no longer answers for drops out of it.
  const candidates = buildCandidates(found.records, competitors)
  const report = await db.transaction(tx => syncRoster(tx, eventId, found.records, competitors, { locations: found.locations, warnings: warnings.length }))
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
