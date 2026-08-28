import { Hono } from 'hono'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, rulesets, matches } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'

const key = z.string().regex(/^[a-z0-9_]{1,20}$/)
const label = z.string().trim().min(1).max(20)
const uniqueKeys = (arr: { key: string }[]) => new Set(arr.map(a => a.key)).size === arr.length
const actionSchema = z.object({ key, label, points: z.number().int().min(-20).max(20) })
const terminalSchema = z.object({ key, label, winType: z.enum(['submission', 'points', 'decision']) })
const rulesetSchema = z.object({
  name: z.string().trim().min(1).max(40),
  defaultLengthSec: z.number().int().min(30).max(1800),
  actions: z.array(actionSchema).min(1).max(12).refine(uniqueKeys, 'duplicate action key'),
  terminals: z.array(terminalSchema).max(6).refine(uniqueKeys, 'duplicate terminal key'),
})

export const rulesetRoutes = new Hono<Env>()

rulesetRoutes.get('/events/:eventId/rulesets', requireAdmin, c => {
  const db = c.get('ctx').db
  return c.json(db.select().from(rulesets).where(eq(rulesets.eventId, Number(c.req.param('eventId')))).orderBy(asc(rulesets.id)).all())
})

rulesetRoutes.post('/events/:eventId/rulesets', requireAdmin, validate('json', rulesetSchema), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  const row = db.insert(rulesets).values({ eventId, ...c.req.valid('json') }).returning().get()
  hub.broadcast(eventId)
  return c.json(row, 201)
})

rulesetRoutes.patch('/rulesets/:rulesetId', requireAdmin, validate('json', rulesetSchema.partial()), c => {
  const { db, hub } = c.get('ctx')
  const id = Number(c.req.param('rulesetId'))
  const existing = db.select().from(rulesets).where(eq(rulesets.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'ruleset not found')
  const fields = c.req.valid('json')
  if (Object.keys(fields).length > 0) db.update(rulesets).set(fields).where(eq(rulesets.id, id)).run()
  hub.broadcast(existing.eventId)
  return c.json(db.select().from(rulesets).where(eq(rulesets.id, id)).get())
})

rulesetRoutes.delete('/rulesets/:rulesetId', requireAdmin, c => {
  const { db, hub } = c.get('ctx')
  const id = Number(c.req.param('rulesetId'))
  const existing = db.select().from(rulesets).where(eq(rulesets.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'ruleset not found')
  if (db.select({ id: matches.id }).from(matches).where(eq(matches.rulesetId, id)).get()) return errorJson(c, 409, 'match_state', 'ruleset is used by a match')
  const count = db.select({ id: rulesets.id }).from(rulesets).where(eq(rulesets.eventId, existing.eventId)).all().length
  if (count <= 1) return errorJson(c, 409, 'match_state', 'an event needs at least one ruleset')
  db.delete(rulesets).where(eq(rulesets.id, id)).run()
  hub.broadcast(existing.eventId)
  return c.body(null, 204)
})
