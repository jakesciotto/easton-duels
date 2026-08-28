import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import { events } from '../db/schema.js'
import { errorJson } from '../auth/middleware.js'

export const boardRoutes = new Hono<Env>()

function eventExists(c: Context<Env>, eventId: number): boolean {
  return c.get('ctx').db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get() !== undefined
}

boardRoutes.get('/events/:eventId/board', c => {
  const eventId = Number(c.req.param('eventId'))
  if (!eventExists(c, eventId)) return errorJson(c, 404, 'not_found', 'event not found')
  return c.json(c.get('ctx').hub.snapshot(eventId))
})

boardRoutes.get('/events/:eventId/stream', c => {
  const eventId = Number(c.req.param('eventId'))
  if (!eventExists(c, eventId)) return errorJson(c, 404, 'not_found', 'event not found')
  const hub = c.get('ctx').hub
  return streamSSE(c, async stream => {
    let open = true
    const unsubscribe = hub.subscribe(eventId, snap => {
      void stream.writeSSE({ event: 'snapshot', data: JSON.stringify(snap) })
    })
    stream.onAbort(() => {
      open = false
      unsubscribe()
    })
    while (open) {
      await stream.sleep(15_000)
      if (open) await stream.writeSSE({ event: 'ping', data: '' })
    }
  })
})
