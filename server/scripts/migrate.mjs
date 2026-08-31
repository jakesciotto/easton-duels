import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, dbUrlFromEnv, initDb, migrateDb } from '../dist/db/client.js'
import { loadDotEnv } from '../dist/lib/env.js'

const here = path.dirname(fileURLToPath(import.meta.url))
loadDotEnv(path.resolve(here, '../../.env'))

const opts = dbUrlFromEnv(process.env)
const target = opts.url.startsWith('file:') ? `file (${opts.url})` : new URL(opts.url).host
console.log(`db:migrate targeting ${target}`)

const db = createDb(opts)
await initDb(db, opts)
await migrateDb(db)

console.log('db:migrate complete')
