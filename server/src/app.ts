import { Hono } from 'hono'
import type { AppContext, Env } from './context.js'
import { attachAuth, errorJson } from './auth/middleware.js'
import { SeqConflict, MatchStateError, DecisionRequired } from './match/events.js'
import { authRoutes } from './routes/auth.js'
import { boardRoutes } from './routes/board.js'
import { eventRoutes } from './routes/events.js'
import { rulesetRoutes } from './routes/rulesets.js'
import { athleteRoutes } from './routes/athletes.js'

export const VERSION = '0.1.0'

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('ctx', ctx)
    await next()
  })
  app.use('/api/*', attachAuth)
  app.get('/api/health', c => c.json({ ok: true, version: VERSION }))
  app.route('/api', authRoutes)
  app.route('/api', boardRoutes)
  app.route('/api', eventRoutes)
  app.route('/api', rulesetRoutes)
  app.route('/api', athleteRoutes)
  app.onError((err, c) => {
    if (err instanceof SeqConflict) return errorJson(c, 409, 'sequence', 'stale sequence', { currentSeq: err.currentSeq })
    if (err instanceof DecisionRequired) return errorJson(c, 422, 'decision_required', 'scores are tied; pick a winner')
    if (err instanceof MatchStateError) return errorJson(c, err.message.includes('not found') ? 404 : 409, 'match_state', err.message)
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500)
  })
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}
