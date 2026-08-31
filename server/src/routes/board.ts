import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events } from '../db/schema.js'
import { errorJson } from '../auth/middleware.js'
import { buildSnapshot } from '../live/snapshot.js'
import { reapBound } from '../live/bound.js'

export const boardRoutes = new Hono<Env>()

boardRoutes.get('/events/:eventId/snapshot', async c => {
  const eventId = Number(c.req.param('eventId'))
  const sinceParam = Number(c.req.query('since'))
  const since = Number.isFinite(sinceParam) ? sinceParam : -1
  const db = c.get('ctx').db
  const now = Date.now()
  await reapBound(db, eventId, now)
  const ev = await db.select({ version: events.version }).from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  if (since === ev.version) return c.json({ version: ev.version, now: new Date(now).toISOString() })
  return c.json({ version: ev.version, snapshot: await buildSnapshot(db, eventId, { nowMs: now }) })
})
