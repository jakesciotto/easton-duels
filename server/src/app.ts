import { Hono } from 'hono'
import type { AppContext, Env } from './context.js'

export const VERSION = '0.1.0'

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('ctx', ctx)
    await next()
  })
  app.get('/api/health', c => c.json({ ok: true, version: VERSION }))
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}
