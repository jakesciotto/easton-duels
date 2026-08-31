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

export function createDb(opts: { url: string; authToken?: string }) {
  if (opts.url.startsWith('file:') && !opts.url.includes(':memory:')) {
    fs.mkdirSync(path.dirname(opts.url.slice('file:'.length)), { recursive: true })
  }
  const client = createClient(opts)
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
