import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events, matches } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { enterResult, createEntry } from '../match/entry.js'
import { resolvePair } from '../match/pairs.js'
import { respond } from './scoring.js'

const entrySchema = z.object({
  entryId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  pointsA: z.number().int().min(0).max(99),
  pointsB: z.number().int().min(0).max(99),
  winnerAthleteId: z.number().int(),
  winType: z.enum(['submission', 'points', 'decision']),
})

const createSchema = entrySchema.extend({
  athleteAId: z.number().int(),
  athleteBId: z.number().int(),
  rulesetId: z.number().int().optional(),
})

export const entryRoutes = new Hono<Env>()

entryRoutes.post('/matches/:matchId/entry', requireAdmin, validate('json', entrySchema), async c => {
  const { db } = c.get('ctx')
  const matchId = Number(c.req.param('matchId'))
  const match = await db.select().from(matches).where(eq(matches.id, matchId)).get()
  if (!match) return errorJson(c, 404, 'not_found', 'match not found')
  const body = c.req.valid('json')
  if (body.winnerAthleteId !== match.athleteAId && body.winnerAthleteId !== match.athleteBId) return errorJson(c, 422, 'validation', 'winner must be one of the two athletes')
  const { duplicate, match: updated } = await enterResult(db, matchId, body)
  return respond(c, updated, !duplicate)
})

entryRoutes.post('/events/:eventId/entries', requireAdmin, validate('json', createSchema), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  const body = c.req.valid('json')
  const pair = await resolvePair(db, eventId, body.athleteAId, body.athleteBId)
  if (typeof pair === 'string') return errorJson(c, 422, 'validation', pair)
  if (body.winnerAthleteId !== pair.a && body.winnerAthleteId !== pair.b) return errorJson(c, 422, 'validation', 'winner must be one of the two athletes')
  const { duplicate, match } = await createEntry(db, eventId, body)
  const res = await respond(c, match, !duplicate)
  return duplicate ? res : new Response(res.body, { status: 201, headers: res.headers })
})
