import path from 'node:path'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq, sql } from 'drizzle-orm'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbLike = Db | Tx

// An explicit DB_PATH wins over Turso: e2e and any local run that names its own file must
// never be redirected to the remote database just because .env carries cloud credentials.
export function dbUrlFromEnv(env: Record<string, string | undefined>): { url: string; authToken?: string } {
  if (env.DB_PATH) return { url: `file:${env.DB_PATH}` }
  if (env.TURSO_DATABASE_URL) return { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN }
  return { url: `file:${path.join(env.DATA_DIR ?? './data', 'duels.db')}` }
}

// Turso intermittently rejects correctly-authorized requests with 401 from serverless
// egress (2026-08-31 incident: identical requests flap by instance while residential
// egress always passes). A short retry at the fetch layer absorbs the flap; real auth
// failures still surface after the retries. Remote URLs only; file databases skip it.
const RETRY_401 = 2
// The libsql client intermittently emits requests WITHOUT its configured Authorization
// header (2026-08-31 incident: Turso answered "empty JWT token" while the env held the
// token and the client was constructed with it). This wrapper enforces the header on
// every outgoing request, logs when it has to inject, and retries 401s on a fresh
// undici connection with properly cloned requests.
function guardedFetch(token: string | undefined, base: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let template = input instanceof Request ? input : new Request(input as RequestInfo, init)
    if (token && !template.headers.get('authorization')) {
      console.warn('libsql auth-inject: outgoing request had no authorization header')
      const h = new Headers(template.headers)
      h.set('authorization', `Bearer ${token}`)
      template = new Request(template, { headers: h })
    }
    // Redirects are followed manually: the fetch spec strips the authorization header on
    // cross-origin redirects, and Turso's balancer can redirect serverless egress, which
    // produced "empty JWT token" rejections while the header was present at this layer.
    const attempt = async (viaAgent?: unknown) => {
      let req = template.clone()
      for (let hop = 0; hop < 3; hop++) {
        const init: RequestInit = { redirect: 'manual', ...(viaAgent ? ({ dispatcher: viaAgent } as RequestInit) : {}) }
        const res = await base(req, init)
        if (res.status < 300 || res.status >= 400) return res
        const loc = res.headers.get('location')
        if (!loc) return res
        console.warn(`libsql redirect ${res.status} -> ${loc.slice(0, 80)}, re-attaching authorization`)
        const h = new Headers(template.headers)
        if (token) h.set('authorization', `Bearer ${token}`)
        req = new Request(new URL(loc, req.url), {
          method: template.method,
          headers: h,
          body: template.method === 'GET' || template.method === 'HEAD' ? undefined : await template.clone().arrayBuffer(),
        })
      }
      return base(template.clone())
    }
    let res = await attempt()
    for (let i = 0; i < RETRY_401 && res.status === 401; i++) {
      try {
        const body = (await res.clone().text()).slice(0, 160)
        console.warn(`libsql 401 from ${res.url} redirected=${res.redirected} body=${JSON.stringify(body)}`)
      } catch { /* body unavailable */ }
      await new Promise(r => setTimeout(r, 150 * (i + 1)))
      console.warn(`libsql 401, retry ${i + 1} of ${RETRY_401} on a fresh connection`)
      try {
        const { Agent } = await import('undici')
        const agent = new Agent({ connections: 1, pipelining: 0 })
        try {
          res = await attempt(agent)
        } finally {
          await agent.close()
        }
      } catch {
        res = await attempt()
      }
    }
    return res
  }) as typeof fetch
}

export function createDb(opts: { url: string; authToken?: string; fetchFn?: typeof fetch }) {
  if (opts.url.startsWith('file:') && !opts.url.includes(':memory:')) {
    fs.mkdirSync(path.dirname(opts.url.slice('file:'.length)), { recursive: true })
  }
  const base = opts.fetchFn ?? (globalThis.fetch as typeof fetch)
  const client = opts.url.startsWith('file:')
    ? createClient({ url: opts.url, authToken: opts.authToken })
    : createClient({ url: opts.url, authToken: opts.authToken, fetch: guardedFetch(opts.authToken, base) })
  return drizzle(client, { schema })
}

export async function initDb(db: Db, opts: { url: string }): Promise<void> {
  await db.run(sql`pragma foreign_keys = on`)
  if (opts.url.startsWith('file:') && !opts.url.includes(':memory:')) {
    await db.run(sql`pragma journal_mode = wal`)
  }
}

const defaultMigrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle')

export async function migrateDb(db: Db, folder = defaultMigrations): Promise<void> {
  await migrate(db, { migrationsFolder: folder })
}

const SECRET_KEY = 'token_secret'

// Two instances cold-starting at once both find no row, so the insert has to tolerate the
// loser's primary key conflict and read back whichever secret actually landed.
export async function getOrCreateSecret(db: DbLike): Promise<string> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, SECRET_KEY)).get()
  if (row) return row.value
  await db.insert(schema.settings)
    .values({ key: SECRET_KEY, value: randomBytes(32).toString('base64url') })
    .onConflictDoNothing().run()
  const created = await db.select().from(schema.settings).where(eq(schema.settings.key, SECRET_KEY)).get()
  if (!created) throw new Error('token secret is missing after insert')
  return created.value
}
