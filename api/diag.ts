// Temporary diagnostic for the production 401 incident. PIN-gated, secret-free output.
// Remove once the incident closes.
import { createClient } from '@libsql/client'

export const config = { api: { bodyParser: false } }

export default async function handler(req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) {
  const key = new URL(req.url ?? '/', 'http://x').searchParams.get('key')
  if (!key || key !== process.env.ADMIN_PIN) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const out: Record<string, unknown> = { node: process.version }
  const url = process.env.TURSO_DATABASE_URL ?? ''
  const token = process.env.TURSO_AUTH_TOKEN ?? ''
  out.urlHost = url.replace('libsql://', '')
  out.tokenLen = token.length
  out.tokenTail = token.slice(-6)
  try {
    const r = await fetch(url.replace('libsql://', 'https://') + '/v2/pipeline', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'select 1' } }, { type: 'close' }] }),
    })
    out.rawPipeline = { status: r.status, body: (await r.text()).slice(0, 160) }
  } catch (e) {
    out.rawPipeline = { error: String(e).slice(0, 160) }
  }
  try {
    const c = createClient({ url, authToken: token })
    const r1 = await c.execute('select count(*) as n from settings')
    out.settings = { ok: true, n: Number(r1.rows[0]?.n) }
    const r2 = await c.execute('select count(*) as n from rate_limits')
    out.rateLimits = { ok: true, n: Number(r2.rows[0]?.n) }
  } catch (e) {
    out.clientError = String(e).slice(0, 200)
  }
  const steps: Record<string, unknown> = {}
  try {
    const { createDb, dbUrlFromEnv, initDb, getOrCreateSecret } = await import('../server/src/db/client.js')
    const { checkLimit } = await import('../server/src/auth/dbRateLimit.js')
    const opts = dbUrlFromEnv(process.env)
    steps.url = opts.url.slice(0, 12)
    steps.hasToken = typeof opts.authToken === 'string' && opts.authToken.length > 0
    const db = createDb(opts)
    try { await initDb(db, opts); steps.initDb = 'ok' } catch (e) { steps.initDb = String(e).slice(0, 120) }
    try { steps.secretLen = (await getOrCreateSecret(db)).length } catch (e) { steps.secret = String(e).slice(0, 120) }
    try { steps.checkLimit = await checkLimit(db, 'pin', 'diag-probe', Date.now()) } catch (e) { steps.checkLimit = String(e).slice(0, 200) }
  } catch (e) {
    steps.import = String(e).slice(0, 200)
  }
  out.appPath = steps
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(out))
}
