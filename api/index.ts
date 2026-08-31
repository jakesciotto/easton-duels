import { handle } from '@hono/node-server/vercel'

type App = Awaited<ReturnType<typeof buildApp>>

async function buildApp() {
  const { createApp } = await import('../server/src/app.js')
  const { createDb, dbUrlFromEnv, initDb, getOrCreateSecret } = await import('../server/src/db/client.js')
  const { validateAdminPin } = await import('../server/src/auth/pin.js')
  const { rosterFromEnv } = await import('../server/src/roster/config.js')
  const opts = dbUrlFromEnv(process.env)
  const db = createDb(opts)
  await initDb(db, opts)
  const app = createApp({
    port: 0, db, secret: await getOrCreateSecret(db),
    adminPin: validateAdminPin(process.env.ADMIN_PIN),
    roster: rosterFromEnv(process.env, { syncBudgetMs: 280_000 }),
    publicUrl: process.env.PUBLIC_URL,
  })
  app.all('*', c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}

let ready: Promise<App> | null = null

// A rejected boot must not be cached: an unmigrated database or a missing ADMIN_PIN would
// otherwise poison this warm instance for its whole life, so the next invocation retries.
function getApp(): Promise<App> {
  ready ??= buildApp().catch(e => {
    ready = null
    throw e
  })
  return ready
}

// Vercel's Node runtime pre-parses JSON bodies and drains the request stream before the
// adapter can read it, so c.req.json() waits forever on POSTs. NODEJS_HELPERS=0 in the
// project env is the primary switch; this export is the belt to that suspender.
export const config = { api: { bodyParser: false } }

export default async function handler(req: unknown, res: unknown) {
  return handle(await getApp())(req as never, res as never)
}
