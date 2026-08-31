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
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(out))
}
