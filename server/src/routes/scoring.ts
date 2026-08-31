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
import { appendMatchEvent, endMatch, undoLastMatchEvent, loadMatch, latestEndedAt, SeqConflict } from '../match/events.js'
import { advanceMat, reopenMatch, setResult, skipMatch } from '../match/mats.js'
import { toMatchView } from '../live/snapshot.js'

export const scoringRoutes = new Hono<Env>()

const matIdFromMatch = (c: Context<Env>): number | null => {
  const row = c.get('ctx').db.select({ matId: matches.matId }).from(matches).where(eq(matches.id, Number(c.req.param('matchId')))).get()
  return row?.matId ?? null
}

function matchView(c: Context<Env>, match: MatchRow) {
  const db = c.get('ctx').db
  const kids = db.select().from(athletes).where(eq(athletes.eventId, match.eventId)).all()
  return toMatchView(match, new Map(kids.map(a => [a.id, a])), latestEndedAt(db, match.id))
}

export function respond(c: Context<Env>, match: MatchRow, bump = true) {
  const { hub, expiry } = c.get('ctx')
  expiry.sync(match)
  const snap = bump ? hub.broadcast(match.eventId) : hub.snapshot(match.eventId)
  return c.json({ match: snap.matches.find(m => m.id === match.id) ?? matchView(c, match), version: snap.version })
}

function seqConflict(c: Context<Env>, matchId: number, err: SeqConflict) {
  return errorJson(c, 409, 'sequence', 'stale sequence', { currentSeq: err.currentSeq, match: matchView(c, loadMatch(c.get('ctx').db, matchId)) })
}

scoringRoutes.post('/events/:eventId/mats/:matId/bind', validate('json', z.object({ code: z.string().regex(/^\d{4}$/) })), c => {
  const ctx = c.get('ctx')
  const ip = clientIp(c)
  if (ctx.limiter.isBlocked(ip)) return errorJson(c, 429, 'rate_limited', 'too many attempts; wait a minute')
  const eventId = Number(c.req.param('eventId'))
  const matId = Number(c.req.param('matId'))
  const ev = ctx.db.select().from(events).where(eq(events.id, eventId)).get()
  const mat = ctx.db.select().from(mats).where(and(eq(mats.id, matId), eq(mats.eventId, eventId))).get()
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

scoringRoutes.post('/mats/:matId/heartbeat', requireMatOrAdmin(c => Number(c.req.param('matId'))), c => {
  const { db, hub } = c.get('ctx')
  const mat = db.select().from(mats).where(eq(mats.id, Number(c.req.param('matId')))).get()
  if (!mat) return errorJson(c, 404, 'not_found', 'mat not found')
  const wasBound = hub.isBound(mat.id)
  hub.heartbeat(mat.id)
  if (!wasBound) hub.broadcast(mat.eventId)
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

scoringRoutes.post('/matches/:matchId/events', requireMatOrAdmin(matIdFromMatch), validate('json', eventBody), c => {
  const matchId = Number(c.req.param('matchId'))
  try {
    const r = appendMatchEvent(c.get('ctx').db, { ...c.req.valid('json'), matchId })
    return respond(c, r.match, !r.duplicate)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.delete('/matches/:matchId/events/last', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({ lastSeq: z.number().int().min(0) })), c => {
  const matchId = Number(c.req.param('matchId'))
  try {
    return respond(c, undoLastMatchEvent(c.get('ctx').db, { matchId, lastSeq: c.req.valid('json').lastSeq }))
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/end', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({ id: clientEventId, lastSeq: z.number().int().min(0), winnerAthleteId: z.number().int().optional() })), c => {
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  try {
    const r = endMatch(db, { ...c.req.valid('json'), matchId })
    if (r.match.matId !== null) advanceMat(db, r.match.matId)
    return respond(c, r.match, !r.duplicate)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/reopen', requireAdmin, c => {
  return respond(c, reopenMatch(c.get('ctx').db, Number(c.req.param('matchId'))))
})

scoringRoutes.post('/matches/:matchId/skip', requireAdmin, c => {
  return respond(c, skipMatch(c.get('ctx').db, Number(c.req.param('matchId'))))
})

scoringRoutes.post('/matches/:matchId/result', requireAdmin, validate('json', z.object({ winnerAthleteId: z.number().int(), winType: z.enum(['submission', 'points', 'decision']) })), c => {
  return respond(c, setResult(c.get('ctx').db, Number(c.req.param('matchId')), c.req.valid('json')))
})
