import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, mats, matches, athletes, type MatchRow } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { clientIp, errorJson, requireAdmin, requireMatOrAdmin } from '../auth/middleware.js'
import { checkLimit, recordFailure } from '../auth/dbRateLimit.js'
import { pinMatches } from '../auth/pin.js'
import { signToken, tokenExpiry } from '../auth/tokens.js'
import { appendMatchEvent, endMatch, undoLastMatchEvent, loadMatch, latestEndedAt, bumpVersion, SeqConflict } from '../match/events.js'
import { advanceMat, reopenMatch, setResult, skipMatch } from '../match/mats.js'
import { expireOverdue } from '../match/lazyExpiry.js'
import { toMatchView, buildSnapshot } from '../live/snapshot.js'
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

// Every caller bumps the version inside its own write transaction, so this only reads.
export async function respond(c: Context<Env>, match: MatchRow) {
  const { db } = c.get('ctx')
  const snap = await buildSnapshot(db, match.eventId, { nowMs: Date.now() })
  return c.json({ match: snap.matches.find(m => m.id === match.id) ?? await matchView(c, match), version: snap.version })
}

// Choke point for the three mat-scoring writes (events, undo, end): expiry runs at
// write entry so a clock that ran out gets closed before the response reflects it.
// Admin CRUD routes (reopen, skip, result) call respond() directly and skip this.
async function respondToScoringEvent(c: Context<Env>, match: MatchRow) {
  await expireOverdue(c.get('ctx').db, match.eventId, Date.now())
  return respond(c, match)
}

async function seqConflict(c: Context<Env>, matchId: number, err: SeqConflict) {
  return errorJson(c, 409, 'sequence', 'stale sequence', { currentSeq: err.currentSeq, match: await matchView(c, await loadMatch(c.get('ctx').db, matchId)) })
}

scoringRoutes.post('/events/:eventId/mats/:matId/bind', validate('json', z.object({ code: z.string().regex(/^\d{4}$/) })), async c => {
  const ctx = c.get('ctx')
  const ip = clientIp(c)
  const limit = await checkLimit(ctx.db, 'bind', ip, Date.now())
  if (!limit.allowed) return errorJson(c, 429, 'rate_limited', 'too many attempts; wait a minute')
  const eventId = Number(c.req.param('eventId'))
  const matId = Number(c.req.param('matId'))
  const ev = await ctx.db.select().from(events).where(eq(events.id, eventId)).get()
  const mat = await ctx.db.select().from(mats).where(and(eq(mats.id, matId), eq(mats.eventId, eventId))).get()
  if (!ev || !mat) return errorJson(c, 404, 'not_found', 'event or mat not found')
  if (!pinMatches(c.req.valid('json').code, ev.matCode)) {
    await recordFailure(ctx.db, 'bind', ip, Date.now())
    return errorJson(c, 401, 'bad_code', 'wrong mat code')
  }
  return c.json({
    token: signToken({ role: 'mat', eventId, matId, exp: tokenExpiry() }, ctx.secret),
    mat: { id: mat.id, number: mat.number },
    event: { id: ev.id, name: ev.name },
  })
})

scoringRoutes.post('/mats/:matId/heartbeat', requireMatOrAdmin(c => Number(c.req.param('matId'))), async c => {
  const { db } = c.get('ctx')
  const mat = await db.select().from(mats).where(eq(mats.id, Number(c.req.param('matId')))).get()
  if (!mat) return errorJson(c, 404, 'not_found', 'mat not found')
  await heartbeatMat(db, mat.id, mat.eventId, Date.now())
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
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  try {
    const r = await db.transaction(async tx => {
      const appended = await appendMatchEvent(tx, { ...c.req.valid('json'), matchId })
      if (!appended.duplicate) await bumpVersion(tx, appended.match.eventId)
      return appended
    })
    return await respondToScoringEvent(c, r.match)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.delete('/matches/:matchId/events/last', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({ lastSeq: z.number().int().min(0) })), async c => {
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  try {
    const match = await db.transaction(async tx => {
      const undone = await undoLastMatchEvent(tx, { matchId, lastSeq: c.req.valid('json').lastSeq })
      await bumpVersion(tx, undone.eventId)
      return undone
    })
    return await respondToScoringEvent(c, match)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/end', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({ id: clientEventId, lastSeq: z.number().int().min(0), winnerAthleteId: z.number().int().optional() })), async c => {
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  try {
    // advanceMat sits outside the idempotency guard so a retry whose advance never landed
    // still advances the mat. The bump is therefore unconditional: on a replay the advance
    // is real visible state, and a version pinned to the duplicate flag would hide it from
    // every poller. A spurious bump costs one snapshot rebuild.
    const r = await db.transaction(async tx => {
      const ended = await endMatch(tx, { ...c.req.valid('json'), matchId })
      if (ended.match.matId !== null) await advanceMat(tx, ended.match.matId)
      await bumpVersion(tx, ended.match.eventId)
      return ended
    })
    return await respondToScoringEvent(c, r.match)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/reopen', requireAdmin, async c => {
  const { db } = c.get('ctx')
  return respond(c, await db.transaction(async tx => {
    const match = await reopenMatch(tx, Number(c.req.param('matchId')))
    await bumpVersion(tx, match.eventId)
    return match
  }))
})

scoringRoutes.post('/matches/:matchId/skip', requireAdmin, async c => {
  const { db } = c.get('ctx')
  return respond(c, await db.transaction(async tx => {
    const match = await skipMatch(tx, Number(c.req.param('matchId')))
    await bumpVersion(tx, match.eventId)
    return match
  }))
})

scoringRoutes.post('/matches/:matchId/result', requireAdmin, validate('json', z.object({ winnerAthleteId: z.number().int(), winType: z.enum(['submission', 'points', 'decision']) })), async c => {
  const { db } = c.get('ctx')
  return respond(c, await db.transaction(async tx => {
    const match = await setResult(tx, Number(c.req.param('matchId')), c.req.valid('json'))
    await bumpVersion(tx, match.eventId)
    return match
  }))
})
