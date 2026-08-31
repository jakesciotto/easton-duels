import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'
import { createDb, initDb, migrateDb, getOrCreateSecret, dbUrlFromEnv } from './db/client.js'
import { validateAdminPin } from './auth/pin.js'
import { RateLimiter } from './auth/rateLimit.js'
import { ExpiryScheduler, expireClock } from './match/expiry.js'
import { bumpVersion } from './match/events.js'
import { rosterFromEnv } from './roster/config.js'
import { lanIp } from './lib/lanIp.js'
import { loadDotEnv } from './lib/env.js'

loadDotEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'))

const port = Number(process.env.PORT ?? 8422)
const adminPin = validateAdminPin(process.env.ADMIN_PIN)

const main = async () => {
  const dbOpts = dbUrlFromEnv(process.env)
  const db = createDb(dbOpts)
  await initDb(db, dbOpts)
  await migrateDb(db)
  const expiry = new ExpiryScheduler(async (matchId, at) => {
    const m = await expireClock(db, matchId, at)
    if (m) await bumpVersion(db, m.eventId)
  })
  await expiry.rebuild(db)

  const roster = rosterFromEnv(process.env)
  if (!roster.wl) console.warn('WL_CLIENT_ID, WL_CLIENT_SECRET, or WL_BUSINESS not set; roster sync disabled')
  if (!roster.leaderboard) console.warn('LEADERBOARD_SUPABASE_URL or LEADERBOARD_SUPABASE_KEY not set; ERP join disabled')

  const app = createApp({ port, db, secret: await getOrCreateSecret(db), adminPin, limiter: new RateLimiter(), expiry, roster })
  // Keeps unknown /api paths from falling through to the SPA index.html fallback below.
  app.all('/api/*', c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  app.use('*', serveStatic({ root: './public' }))
  app.use('*', serveStatic({ root: './public', rewriteRequestPath: () => '/index.html' }))

  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => console.log(`duels on http://${lanIp()}:${port}`))
}

void main()
