import path from 'node:path'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbLike = Db | Tx

export function createDb(dbPath: string) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

const defaultMigrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle')

export function migrateDb(db: Db, folder = defaultMigrations) {
  migrate(db, { migrationsFolder: folder })
}

const SECRET_KEY = 'token_secret'

export function getOrCreateSecret(db: DbLike): string {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, SECRET_KEY)).get()
  if (row) return row.value
  const value = randomBytes(32).toString('base64url')
  db.insert(schema.settings).values({ key: SECRET_KEY, value }).run()
  return value
}
