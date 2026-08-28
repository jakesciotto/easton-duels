import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, rulesets, mats, matches } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { generateMatches } from '../matchmaker/generate.js'
import { resolvePair, leastLoadedMat } from '../match/pairs.js'
import { eventDetail } from './events.js'

const createSchema = z.object({
  athleteAId: z.number().int(),
  athleteBId: z.number().int(),
  rulesetId: z.number().int().optional(),
  lengthSec: z.number().int().min(30).max(1800).optional(),
  matId: z.number().int().nullable().optional(),
})
const patchSchema = createSchema.partial()

export const matchRoutes = new Hono<Env>()

matchRoutes.post('/events/:eventId/matches/generate', requireAdmin, c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const result = generateMatches(db, eventId)
  hub.broadcast(eventId)
  return c.json(result)
})

matchRoutes.post('/events/:eventId/matches', requireAdmin, validate('json', createSchema), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  const body = c.req.valid('json')
  const pair = resolvePair(db, eventId, body.athleteAId, body.athleteBId)
  if (typeof pair === 'string') return errorJson(c, 422, 'validation', pair)
  const ruleset = body.rulesetId !== undefined
    ? db.select().from(rulesets).where(and(eq(rulesets.id, body.rulesetId), eq(rulesets.eventId, eventId))).get()
    : db.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).get()
  if (!ruleset) return errorJson(c, 422, 'validation', 'ruleset is not on this event')
  if (body.matId !== undefined && body.matId !== null && !db.select({ id: mats.id }).from(mats).where(and(eq(mats.id, body.matId), eq(mats.eventId, eventId))).get()) {
    return errorJson(c, 422, 'validation', 'mat is not on this event')
  }
  const max = db.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), -1)` }).from(matches).where(eq(matches.eventId, eventId)).get()
  const row = db.insert(matches).values({
    eventId, athleteAId: pair.a, athleteBId: pair.b, rulesetId: ruleset.id,
    lengthSec: body.lengthSec ?? ruleset.defaultLengthSec,
    matId: body.matId === undefined ? leastLoadedMat(db, eventId) : body.matId,
    orderIndex: (max?.m ?? -1) + 1,
  }).returning().get()
  hub.broadcast(eventId)
  return c.json(row, 201)
})

matchRoutes.patch('/matches/:matchId', requireAdmin, validate('json', patchSchema), c => {
  const { db, hub } = c.get('ctx')
  const id = Number(c.req.param('matchId'))
  const existing = db.select().from(matches).where(eq(matches.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'match not found')
  if (existing.status !== 'pending') return errorJson(c, 409, 'match_state', 'only a pending match can be edited')
  const body = c.req.valid('json')
  const update: Partial<typeof matches.$inferInsert> = {}
  if (body.athleteAId !== undefined || body.athleteBId !== undefined) {
    const pair = resolvePair(db, existing.eventId, body.athleteAId ?? existing.athleteAId, body.athleteBId ?? existing.athleteBId)
    if (typeof pair === 'string') return errorJson(c, 422, 'validation', pair)
    update.athleteAId = pair.a
    update.athleteBId = pair.b
    update.why = null
  }
  if (body.rulesetId !== undefined) {
    if (!db.select({ id: rulesets.id }).from(rulesets).where(and(eq(rulesets.id, body.rulesetId), eq(rulesets.eventId, existing.eventId))).get()) return errorJson(c, 422, 'validation', 'ruleset is not on this event')
    update.rulesetId = body.rulesetId
  }
  if (body.lengthSec !== undefined) update.lengthSec = body.lengthSec
  if (body.matId !== undefined) {
    if (body.matId !== null && !db.select({ id: mats.id }).from(mats).where(and(eq(mats.id, body.matId), eq(mats.eventId, existing.eventId))).get()) return errorJson(c, 422, 'validation', 'mat is not on this event')
    update.matId = body.matId
  }
  if (Object.keys(update).length > 0) db.update(matches).set(update).where(eq(matches.id, id)).run()
  hub.broadcast(existing.eventId)
  return c.json(db.select().from(matches).where(eq(matches.id, id)).get())
})

matchRoutes.delete('/matches/:matchId', requireAdmin, c => {
  const { db, hub } = c.get('ctx')
  const id = Number(c.req.param('matchId'))
  const existing = db.select().from(matches).where(eq(matches.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'match not found')
  if (existing.status !== 'pending') return errorJson(c, 409, 'match_state', 'only a pending match can be deleted')
  db.transaction(tx => {
    tx.update(mats).set({ currentMatchId: null }).where(eq(mats.currentMatchId, id)).run()
    tx.delete(matches).where(eq(matches.id, id)).run()
  })
  hub.broadcast(existing.eventId)
  return c.body(null, 204)
})

matchRoutes.post('/events/:eventId/matches/reorder', requireAdmin, validate('json', z.object({ ids: z.array(z.number().int()).min(1) })), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const { ids } = c.req.valid('json')
  const current = db.select({ id: matches.id }).from(matches).where(eq(matches.eventId, eventId)).all().map(m => m.id)
  const same = current.length === ids.length && current.every(id => ids.includes(id))
  if (!same) return errorJson(c, 422, 'validation', 'ids must be every match of the event exactly once')
  db.transaction(tx => {
    ids.forEach((id, i) => tx.update(matches).set({ orderIndex: i }).where(eq(matches.id, id)).run())
  })
  hub.broadcast(eventId)
  return c.json(eventDetail(db, eventId)!.matches)
})
