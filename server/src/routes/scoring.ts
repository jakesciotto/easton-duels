import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, mats, matches, athletes, type MatchRow } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { clientIp, errorJson, requireAdmin, requireMatOrAdmin } from '../auth/middleware.js'
import { pinMatches } from '../auth/pin.js'
import { signToken, tokenExpiry } from '../auth/tokens.js'
import { appendMatchEvent, endMatch, undoLastMatchEvent, loadMatch, latestEndedAt, bumpVersion, SeqConflict } from '../match/events.js'
import { advanceMat, reopenMatch, setResult, skipMatch } from '../match/mats.js'
import { toMatchView } from '../live/snapshot.js'
import { heartbeatMat } from '../live/bound.js'

export const scoringRoutes = new Hono<Env>()

const matIdFromMatch = async (c: Context<Env>): Promise<number | null> => {
  const row = await c.get('ctx').db.select({ matId: matches.matId }).from(matches).where(eq(matches.id, Number(c.req.param('matchId')))).get()
  return row?.matId ?? null
}

async function matchView(c: Context<Env>, match: MatchRow) {
  const db = c.get('ctx').db
  const kids = await db.select().from(athletes).where(eq(athletes.eventId, match.eventId)).all()
  return toMatchView(match, new Map(kids.map(a => [a.id, a])), await latestEndedAt(db, match.id))
}

export async function respond(c: Context<Env>, match: MatchRow, bump = true) {
  const { db, hub, expiry } = c.get('ctx')
  expiry.sync(match)
  if (bump) await bumpVersion(db, match.eventId)
  const snap = bump ? await hub.broadcast(match.eventId) : await hub.snapshot(match.eventId)
  return c.json({ match: snap.matches.find(m => m.id === match.id) ?? await matchView(c, match), version: snap.version })
}

async function seqConflict(c: Context<Env>, matchId: number, err: SeqConflict) {
  return errorJson(c, 409, 'sequence', 'stale sequence', { currentSeq: err.currentSeq, match: await matchView(c, await loadMatch(c.get('ctx').db, matchId)) })
}

scoringRoutes.post('/events/:eventId/mats/:matId/bind', validate('json', z.object({ code: z.string().regex(/^\d{4}$/) })), async c => {
  const ctx = c.get('ctx')
  const ip = clientIp(c)
  if (ctx.limiter.isBlocked(ip)) return errorJson(c, 429, 'rate_limited', 'too many attempts; wait a minute')
  const eventId = Number(c.req.param('eventId'))
  const matId = Number(c.req.param('matId'))
  const ev = await ctx.db.select().from(events).where(eq(events.id, eventId)).get()
  const mat = await ctx.db.select().from(mats).where(and(eq(mats.id, matId), eq(mats.eventId, eventId))).get()
  if (!ev || !mat) return errorJson(c, 404, 'not_found', 'event or mat not found')
  if (!pinMatches(c.req.valid('json').code, ev.matCode)) {
    ctx.limiter.recordFailure(ip)
    return errorJson(c, 401, 'bad_code', 'wrong mat code')
  }
  return c.json({
    token: signToken({ role: 'mat', eventId, matId, exp: tokenExpiry() }, ctx.secret),
    mat: { id: mat.id, number: mat.number },
    event: { id: ev.id, name: ev.name },
  })
})

scoringRoutes.post('/mats/:matId/heartbeat', requireMatOrAdmin(c => Number(c.req.param('matId'))), async c => {
  const { db, hub } = c.get('ctx')
  const mat = await db.select().from(mats).where(eq(mats.id, Number(c.req.param('matId')))).get()
  if (!mat) return errorJson(c, 404, 'not_found', 'mat not found')
  const wasBound = mat.bound
  await heartbeatMat(db, mat.id, mat.eventId, Date.now())
  if (!wasBound) await hub.broadcast(mat.eventId)
  return c.json({ ok: true })
})

const clientEventId = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/)

const eventBody = z.object({
  id: clientEventId,
  type: z.enum(['score', 'clock_start', 'clock_pause', 'terminal']),
  athleteId: z.number().int().optional(),
  actionKey: z.string().max(20).optional(),
  lastSeq: z.number().int().min(0),
})

scoringRoutes.post('/matches/:matchId/events', requireMatOrAdmin(matIdFromMatch), validate('json', eventBody), async c => {
  const matchId = Number(c.req.param('matchId'))
  try {
    const r = await appendMatchEvent(c.get('ctx').db, { ...c.req.valid('json'), matchId })
    return await respond(c, r.match, !r.duplicate)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.delete('/matches/:matchId/events/last', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({ lastSeq: z.number().int().min(0) })), async c => {
  const matchId = Number(c.req.param('matchId'))
  try {
    return await respond(c, await undoLastMatchEvent(c.get('ctx').db, { matchId, lastSeq: c.req.valid('json').lastSeq }))
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/end', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({ id: clientEventId, lastSeq: z.number().int().min(0), winnerAthleteId: z.number().int().optional() })), async c => {
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  try {
    const r = await endMatch(db, { ...c.req.valid('json'), matchId })
    if (r.match.matId !== null) await advanceMat(db, r.match.matId)
    return await respond(c, r.match, !r.duplicate)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/reopen', requireAdmin, async c => {
  return respond(c, await reopenMatch(c.get('ctx').db, Number(c.req.param('matchId'))))
})

scoringRoutes.post('/matches/:matchId/skip', requireAdmin, async c => {
  return respond(c, await skipMatch(c.get('ctx').db, Number(c.req.param('matchId'))))
})

scoringRoutes.post('/matches/:matchId/result', requireAdmin, validate('json', z.object({ winnerAthleteId: z.number().int(), winType: z.enum(['submission', 'points', 'decision']) })), async c => {
  return respond(c, await setResult(c.get('ctx').db, Number(c.req.param('matchId')), c.req.valid('json')))
})
