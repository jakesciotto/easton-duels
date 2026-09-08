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
import { appendMatchEvent, endMatch, extendClock, undoLastMatchEvent, loadMatch, latestEndedAt, bumpVersion, MatchStateError, SeqConflict } from '../match/events.js'
import { advanceMat, reopenMatch, skipMatch } from '../match/mats.js'
import { expireOverdue } from '../match/lazyExpiry.js'
import { toMatchView, buildSnapshot } from '../live/snapshot.js'
import { bindMat, heartbeatMat, unbindMat } from '../live/bound.js'
import { recordAudit, actorOf, matNumberOf, actorOfMatchEventId } from '../audit/log.js'
import { assertNotCertified, assertNotCertifiedVia } from '../audit/certify.js'
import { EXTEND_MAX_MS, EXTEND_MIN_MS, type AuditActor } from '../shared/types.js'

export const scoringRoutes = new Hono<Env>()

const matIdFromMatch = async (c: Context<Env>): Promise<number | null> => {
  const row = await c.get('ctx').db.select({ matId: matches.matId }).from(matches).where(eq(matches.id, Number(c.req.param('matchId')))).get()
  return row?.matId ?? null
}

// These routes take either token, so the mat number is looked up once per write rather
// than being carried in the token, which predates the audit log.
async function actorFor(c: Context<Env>): Promise<AuditActor> {
  const auth = c.get('auth')
  return actorOf(auth, await matNumberOf(c.get('ctx').db, auth))
}

async function matchView(c: Context<Env>, match: MatchRow) {
  const db = c.get('ctx').db
  const kids = await db.select().from(athletes).where(eq(athletes.eventId, match.eventId)).all()
  return toMatchView(match, new Map(kids.map(a => [a.id, a])), await latestEndedAt(db, match.id))
}

// Every caller bumps the version inside its own write transaction, so this only reads.
export async function respond(c: Context<Env>, match: MatchRow) {
  return respondOptional(c, match.eventId, match)
}

// The same envelope for a write that can legitimately produce no match, which is what an
// advance onto an empty queue does.
export async function respondOptional(c: Context<Env>, eventId: number, match: MatchRow | null) {
  const { db } = c.get('ctx')
  const snap = await buildSnapshot(db, eventId, { nowMs: Date.now() })
  const view = match === null ? null : snap.matches.find(m => m.id === match.id) ?? await matchView(c, match)
  return c.json({ match: view, version: snap.version })
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

scoringRoutes.post('/events/:eventId/mats/:matId/bind', validate('json', z.object({ code: z.string().regex(/^\d{4}$/), takeOver: z.boolean().optional() })), async c => {
  const ctx = c.get('ctx')
  const ip = clientIp(c)
  const limit = await checkLimit(ctx.db, 'bind', ip, Date.now())
  if (!limit.allowed) return errorJson(c, 429, 'rate_limited', 'too many attempts; wait a minute')
  const eventId = Number(c.req.param('eventId'))
  const matId = Number(c.req.param('matId'))
  const ev = await ctx.db.select().from(events).where(eq(events.id, eventId)).get()
  const mat = await ctx.db.select().from(mats).where(and(eq(mats.id, matId), eq(mats.eventId, eventId))).get()
  if (!ev || !mat) return errorJson(c, 404, 'not_found', 'event or mat not found')
  const body = c.req.valid('json')
  if (!pinMatches(body.code, ev.matCode)) {
    await recordFailure(ctx.db, 'bind', ip, Date.now())
    return errorJson(c, 401, 'bad_code', 'wrong mat code')
  }
  // A mat token is a write credential, and in a desk event the desk is already typing the
  // results, so a second writer would fight it over the same matches. The tablet refuses
  // too, but that guard is advisory: a stale tab, a bookmarked link or a retried request
  // reaches here without it. Checked after the code so an unauthenticated caller learns
  // nothing about the event. Existing tokens keep working, because the desk path is the
  // fallback for tablets that failed and cutting them off mid-afternoon helps nobody.
  //
  // A certified event is signed off, so there is nothing left for a tablet to score
  // either. Both refusals sit here, after the code, for the same reason.
  await assertNotCertified(ctx.db, eventId)
  if (ev.mode === 'entry') {
    return errorJson(c, 409, 'desk_mode',
      'This event runs from the desk. Every result is typed on the Entry tab, so there is no mat for this iPad to score.')
  }
  const bound = await bindMat(ctx.db, matId, eventId, Date.now(), body.takeOver ?? false)
  if (bound === null) {
    return errorJson(c, 409, 'mat_bound',
      'This mat already has an iPad scoring it. Take it over to score from here instead.')
  }
  return c.json({
    token: signToken({ role: 'mat', eventId, matId, epoch: bound.epoch, exp: tokenExpiry() }, ctx.secret),
    mat: { id: mat.id, number: mat.number },
    event: { id: ev.id, name: ev.name },
  })
})

// The mats advance themselves when a match ends, but a mat that is idle when a match is
// added or moved onto it has nothing to trigger on, and neither does a mat created after
// Start. This is the Live panel's Call the next match.
scoringRoutes.post('/mats/:matId/advance', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const matId = Number(c.req.param('matId'))
  const mat = await db.select().from(mats).where(eq(mats.id, matId)).get()
  if (!mat) return errorJson(c, 404, 'not_found', 'mat not found')
  await assertNotCertified(db, mat.eventId)
  const advanced = await db.transaction(async tx => {
    if (mat.currentMatchId !== null) {
      const current = await tx.select({ status: matches.status }).from(matches).where(eq(matches.id, mat.currentMatchId)).get()
      if (current?.status === 'live') throw new MatchStateError('This mat is already showing a match')
    }
    const next = await advanceMat(tx, matId)
    if (next) {
      await recordAudit(tx, {
        eventId: mat.eventId, matchId: next.id, actor: 'admin', action: 'advance',
        detail: { matId, matNumber: mat.number },
      })
      await bumpVersion(tx, mat.eventId)
    }
    return next
  })
  return respondOptional(c, mat.eventId, advanced)
})

scoringRoutes.post('/mats/:matId/unbind', requireMatOrAdmin(c => Number(c.req.param('matId'))), async c => {
  const { db } = c.get('ctx')
  const mat = await db.select().from(mats).where(eq(mats.id, Number(c.req.param('matId')))).get()
  if (!mat) return errorJson(c, 404, 'not_found', 'mat not found')
  await unbindMat(db, mat.id, mat.eventId, await actorFor(c))
  return c.json({ ok: true })
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
  const body = c.req.valid('json')
  const actor = await actorFor(c)
  await assertNotCertifiedVia(db, 'match', matchId)
  try {
    const r = await db.transaction(async tx => {
      const appended = await appendMatchEvent(tx, { ...body, matchId })
      if (!appended.duplicate) {
        // The points and the label are what the ruleset said at the moment of the press.
        // The sheet reads them back rather than looking the action up again, so editing a
        // ruleset after the match cannot rewrite a match that already happened.
        await recordAudit(tx, {
          eventId: appended.match.eventId, matchId, actor, action: body.type,
          detail: {
            seq: appended.match.lastSeq, athleteId: body.athleteId ?? null, actionKey: body.actionKey ?? null,
            ...appended.scored,
          },
        })
        await bumpVersion(tx, appended.match.eventId)
      }
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
  const actor = await actorFor(c)
  await assertNotCertifiedVia(db, 'match', matchId)
  try {
    const match = await db.transaction(async tx => {
      const { match: undone, deleted } = await undoLastMatchEvent(tx, { matchId, lastSeq: c.req.valid('json').lastSeq })
      // The deleted row is gone from the match log, so everything about it that a person
      // would want to see afterwards has to live in this one detail.
      await recordAudit(tx, {
        eventId: undone.eventId, matchId, actor, action: 'undo',
        detail: {
          seq: deleted.seq, type: deleted.type, actor: actorOfMatchEventId(deleted.id, actor),
          athleteId: deleted.athleteId, actionKey: deleted.actionKey, points: deleted.points,
          payload: deleted.payload ?? null, at: deleted.at,
        },
      })
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
  const actor = await actorFor(c)
  await assertNotCertifiedVia(db, 'match', matchId)
  try {
    // advanceMat sits outside the idempotency guard so a retry whose advance never landed
    // still advances the mat. The bump is therefore unconditional: on a replay the advance
    // is real visible state, and a version pinned to the duplicate flag would hide it from
    // every poller. A spurious bump costs one snapshot rebuild.
    const r = await db.transaction(async tx => {
      const ended = await endMatch(tx, { ...c.req.valid('json'), matchId })
      if (!ended.duplicate) {
        await recordAudit(tx, {
          eventId: ended.match.eventId, matchId, actor, action: 'end',
          detail: { seq: ended.match.lastSeq, winnerAthleteId: ended.match.winnerAthleteId, winType: ended.match.winType },
        })
      }
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

// The clock is the only state a referee cannot correct after the fact, so a match that
// ran out gets time added rather than a result nobody agrees with. Expiry runs first: a
// clock past its length is still marked running until something sweeps it, and time can
// only be added to a stopped clock.
scoringRoutes.post('/matches/:matchId/clock/extend', requireMatOrAdmin(matIdFromMatch), validate('json', z.object({
  id: clientEventId,
  lastSeq: z.number().int().min(0),
  addMs: z.number().int().min(EXTEND_MIN_MS).max(EXTEND_MAX_MS),
})), async c => {
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  const body = c.req.valid('json')
  const actor = await actorFor(c)
  await assertNotCertifiedVia(db, 'match', matchId)
  await expireOverdue(db, (await loadMatch(db, matchId)).eventId, Date.now())
  try {
    const r = await db.transaction(async tx => {
      const extended = await extendClock(tx, { ...body, matchId })
      if (!extended.duplicate) {
        await recordAudit(tx, {
          eventId: extended.match.eventId, matchId, actor, action: 'clock_extend',
          detail: { seq: extended.match.lastSeq, addMs: body.addMs },
        })
        await bumpVersion(tx, extended.match.eventId)
      }
      return extended
    })
    return await respond(c, r.match)
  } catch (e) {
    if (e instanceof SeqConflict) return seqConflict(c, matchId, e)
    throw e
  }
})

scoringRoutes.post('/matches/:matchId/reopen', requireAdmin, async c => {
  const { db } = c.get('ctx')
  await assertNotCertifiedVia(db, 'match', Number(c.req.param('matchId')))
  return respond(c, await db.transaction(async tx => {
    const match = await reopenMatch(tx, Number(c.req.param('matchId')))
    await recordAudit(tx, { eventId: match.eventId, matchId: match.id, actor: 'admin', action: 'reopen', detail: { seq: match.lastSeq } })
    await bumpVersion(tx, match.eventId)
    return match
  }))
})

// Older clients send no body at all, so an absent one parses as an empty object and the
// write keeps its server-minted event id.
const optionalClientId = z.object({ id: clientEventId.optional() }).optional()

async function clientIdOf(c: Context<Env>): Promise<{ id?: string } | Response> {
  const parsed = optionalClientId.safeParse(await c.req.json().catch(() => undefined))
  if (!parsed.success) return errorJson(c, 422, 'validation', parsed.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  return parsed.data ?? {}
}

scoringRoutes.post('/matches/:matchId/skip', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const body = await clientIdOf(c)
  if (body instanceof Response) return body
  await assertNotCertifiedVia(db, 'match', Number(c.req.param('matchId')))
  return respond(c, await db.transaction(async tx => {
    const r = await skipMatch(tx, Number(c.req.param('matchId')), body.id)
    if (!r.duplicate) {
      await recordAudit(tx, { eventId: r.match.eventId, matchId: r.match.id, actor: 'admin', action: 'skip', detail: { seq: r.match.lastSeq } })
      await bumpVersion(tx, r.match.eventId)
    }
    return r.match
  }))
})
