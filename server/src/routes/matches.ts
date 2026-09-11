import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Env } from '../context.js'
import { auditLog, events, rulesets, mats, matches } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { generateMatches } from '../matchmaker/generate.js'
import { eventDetail } from './events.js'
import { bumpVersion } from '../match/events.js'
import { createMatch } from '../match/create.js'
import { resolvePair } from '../match/pairs.js'
import { recordAudit, HISTORY_LIMIT } from '../audit/log.js'
import { assertNotCertified } from '../audit/certify.js'
import type { AuditEntry } from '../shared/types.js'
import { advanceMat } from '../match/mats.js'

const createSchema = z.object({
  athleteAId: z.number().int(),
  athleteBId: z.number().int(),
  rulesetId: z.number().int().optional(),
  lengthSec: z.number().int().min(30).max(1800).optional(),
  matId: z.number().int().nullable().optional(),
})
const patchSchema = createSchema.partial()

export const matchRoutes = new Hono<Env>()

// No existence check: the audit log outlives the rows it describes, so the history of a
// match somebody deleted is exactly the history worth reading. An unknown id has no rows
// and answers with none. Oldest first, because the sheet reads downwards.
matchRoutes.get('/matches/:matchId/history', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const rows: AuditEntry[] = await db.select({
    id: auditLog.id, at: auditLog.at, actor: auditLog.actor, action: auditLog.action, detail: auditLog.detail,
  }).from(auditLog).where(eq(auditLog.matchId, Number(c.req.param('matchId')))).orderBy(asc(auditLog.id)).limit(HISTORY_LIMIT).all()
  return c.json(rows)
})

matchRoutes.post('/events/:eventId/matches/generate', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  await assertNotCertified(db, eventId)
  const result = await db.transaction(async tx => {
    const generated = await generateMatches(tx, eventId)
    await recordAudit(tx, { eventId, actor: 'admin', action: 'generate', detail: { created: generated.created } })
    await bumpVersion(tx, eventId)
    return generated
  })
  return c.json(result)
})

matchRoutes.post('/events/:eventId/matches', requireAdmin, validate('json', createSchema), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  await assertNotCertified(db, eventId)
  const body = c.req.valid('json')
  const created = await createMatch(db, { eventId, ...body, source: 'designed' })
  if (!created.ok) return errorJson(c, 422, 'validation', created.message)
  return c.json(created.match, 201)
})

matchRoutes.patch('/matches/:matchId', requireAdmin, validate('json', patchSchema), async c => {
  const { db } = c.get('ctx')
  const id = Number(c.req.param('matchId'))
  const existing = await db.select().from(matches).where(eq(matches.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'match not found')
  await assertNotCertified(db, existing.eventId)
  if (existing.status !== 'pending') return errorJson(c, 409, 'match_state', 'only a pending match can be edited. End it from the Live tab, then edit the result.')
  const body = c.req.valid('json')
  const update: Partial<typeof matches.$inferInsert> = {}
  if (body.athleteAId !== undefined || body.athleteBId !== undefined) {
    const pair = await resolvePair(db, existing.eventId, body.athleteAId ?? existing.athleteAId, body.athleteBId ?? existing.athleteBId)
    if (typeof pair === 'string') return errorJson(c, 422, 'validation', pair)
    update.athleteAId = pair.a
    update.athleteBId = pair.b
    update.why = null
  }
  if (body.rulesetId !== undefined) {
    if (!await db.select({ id: rulesets.id }).from(rulesets).where(and(eq(rulesets.id, body.rulesetId), eq(rulesets.eventId, existing.eventId))).get()) return errorJson(c, 422, 'validation', 'ruleset is not on this event')
    update.rulesetId = body.rulesetId
  }
  if (body.lengthSec !== undefined) update.lengthSec = body.lengthSec
  if (body.matId !== undefined) {
    if (body.matId !== null && !await db.select({ id: mats.id }).from(mats).where(and(eq(mats.id, body.matId), eq(mats.eventId, existing.eventId))).get()) return errorJson(c, 422, 'validation', 'mat is not on this event')
    update.matId = body.matId
  }
  await db.transaction(async tx => {
    if (Object.keys(update).length > 0) await tx.update(matches).set(update).where(eq(matches.id, id)).run()
    if (update.matId !== undefined && update.matId !== null) await advanceMat(tx, update.matId, 'admin')
    await recordAudit(tx, { eventId: existing.eventId, matchId: id, actor: 'admin', action: 'match_edit', detail: { fields: Object.keys(update), ...update } })
    await bumpVersion(tx, existing.eventId)
  })
  return c.json(await db.select().from(matches).where(eq(matches.id, id)).get())
})

matchRoutes.delete('/matches/:matchId', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const id = Number(c.req.param('matchId'))
  const existing = await db.select().from(matches).where(eq(matches.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'match not found')
  await assertNotCertified(db, existing.eventId)
  if (existing.status !== 'pending') return errorJson(c, 409, 'match_state', 'only a pending match can be deleted. End it from the Live tab, then edit the result.')
  await db.transaction(async tx => {
    await tx.update(mats).set({ currentMatchId: null }).where(eq(mats.currentMatchId, id)).run()
    await tx.delete(matches).where(eq(matches.id, id)).run()
    await recordAudit(tx, {
      eventId: existing.eventId, matchId: id, actor: 'admin', action: 'match_delete',
      detail: { athleteAId: existing.athleteAId, athleteBId: existing.athleteBId, matId: existing.matId },
    })
    await bumpVersion(tx, existing.eventId)
  })
  return c.body(null, 204)
})

matchRoutes.post('/events/:eventId/matches/reorder', requireAdmin, validate('json', z.object({ ids: z.array(z.number().int()).min(1) })), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const { ids } = c.req.valid('json')
  await assertNotCertified(db, eventId)
  const current = (await db.select({ id: matches.id }).from(matches).where(eq(matches.eventId, eventId)).all()).map(m => m.id)
  const same = current.length === ids.length && current.every(id => ids.includes(id))
  if (!same) return errorJson(c, 422, 'validation', 'ids must be every match of the event exactly once')
  await db.transaction(async tx => {
    for (const [i, id] of ids.entries()) await tx.update(matches).set({ orderIndex: i }).where(eq(matches.id, id)).run()
    await recordAudit(tx, { eventId, actor: 'admin', action: 'reorder', detail: { count: ids.length, ids } })
    await bumpVersion(tx, eventId)
  })
  return c.json((await eventDetail(db, eventId))!.matches)
})
