import { handle } from '@hono/node-server/vercel'

// Build per invocation. A module-singleton app carries one libsql http client across
// invocations, and Vercel freezes the instance between them; the thawed client's stream
// state then fails against Turso with HTTP 401 on the next query, while a fresh client
// works every time (proven by the diag function during the 2026-08-31 incident). The
// token secret is cached at module scope so a rebuild costs the pragma round trip, not
// a settings query, and createApp itself is pure route registration.
let cachedSecret: string | null = null

async function buildApp() {
  const { createApp } = await import('../server/src/app.js')
  const { createDb, dbUrlFromEnv, initDb, getOrCreateSecret } = await import('../server/src/db/client.js')
  const { validateAdminPin } = await import('../server/src/auth/pin.js')
  const { rosterFromEnv } = await import('../server/src/roster/config.js')
  const opts = dbUrlFromEnv(process.env)
  const db = createDb(opts)
  await initDb(db, opts)
  cachedSecret ??= await getOrCreateSecret(db)
  const app = createApp({
    port: 0, db, secret: cachedSecret,
    adminPin: validateAdminPin(process.env.ADMIN_PIN),
    roster: rosterFromEnv(process.env, { syncBudgetMs: 280_000 }),
    publicUrl: process.env.PUBLIC_URL,
  })
  app.all('*', c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
}

// Vercel's Node runtime pre-parses JSON bodies and drains the request stream before the
// adapter can read it, so c.req.json() waits forever on POSTs. Turning the platform body
// parser off hands the raw stream through untouched.
export const config = { api: { bodyParser: false } }

export default async function handler(req: unknown, res: unknown) {
  // Temporary incident branch: report this function's own env view, secret-free.
  const r = req as { url?: string }
  const w = res as { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }
  if (r.url?.includes('__envtail=1')) {
    const key = new URL(r.url, 'http://x').searchParams.get('key')
    if (key && key === process.env.ADMIN_PIN) {
      const t = process.env.TURSO_AUTH_TOKEN ?? ''
      const url = process.env.TURSO_DATABASE_URL ?? ''
      const out: Record<string, unknown> = { fn: 'index', node: process.version, tokenLen: t.length, tokenTail: t.slice(-6) }
      try {
        const r = await fetch(url.replace('libsql://', 'https://') + '/v2/pipeline', {
          method: 'POST',
          headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
          body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'select 1' } }, { type: 'close' }] }),
        })
        out.rawPipeline = r.status
      } catch (e) { out.rawPipeline = String(e).slice(0, 120) }
      try {
        const { createClient } = await import('@libsql/client')
        const c = createClient({ url, authToken: t })
        await c.execute('select 1')
        out.directClient = 'ok'
      } catch (e) { out.directClient = String(e).slice(0, 160) }
      try {
        const { createDb, dbUrlFromEnv, initDb } = await import('../server/src/db/client.js')
        const opts = dbUrlFromEnv(process.env)
        const db = createDb(opts)
        await initDb(db, opts)
        out.appClient = 'ok'
      } catch (e) { out.appClient = String(e).slice(0, 160) }
      w.statusCode = 200
      w.setHeader('content-type', 'application/json')
      w.end(JSON.stringify(out))
      return
    }
  }
  return handle(await buildApp())(req as never, res as never)
}
