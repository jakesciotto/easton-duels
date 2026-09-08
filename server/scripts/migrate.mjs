import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, dbUrlFromEnv, initDb, migrateDb } from '../dist/db/client.js'
import { loadDotEnv } from '../dist/lib/env.js'

const here = path.dirname(fileURLToPath(import.meta.url))
loadDotEnv(path.resolve(here, '../../.env'))

// `--to <tag>` stops after that migration. A release whose newest migration drops a
// column the running build still reads has to land in two steps: the additive files
// before the deploy, the drop after it. Drizzle runs whatever the journal lists, so the
// stop is a temporary folder holding the same files with the journal cut at the tag; the
// hash it records per file is the file's own SQL, so a later full run skips them.
const args = process.argv.slice(2)
const toIndex = args.indexOf('--to')
const upTo = toIndex === -1 ? null : args[toIndex + 1]
if (toIndex !== -1 && !upTo) {
  console.error('usage: migrate.mjs [--to <migration tag>]')
  process.exit(2)
}

const source = path.resolve(here, '../drizzle')
let folder = source
let cleanup = () => {}
if (upTo !== null) {
  const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta/_journal.json'), 'utf8'))
  const stop = journal.entries.findIndex(e => e.tag === upTo || e.tag.startsWith(`${upTo}_`))
  if (stop === -1) {
    console.error(`no migration tagged ${upTo}`)
    process.exit(2)
  }
  const kept = journal.entries.slice(0, stop + 1)
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-migrate-'))
  fs.mkdirSync(path.join(folder, 'meta'))
  fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: kept }))
  for (const entry of kept) fs.copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`))
  cleanup = () => fs.rmSync(folder, { recursive: true, force: true })
  console.log(`db:migrate stopping after ${kept[kept.length - 1].tag} (${journal.entries.length - kept.length} held back)`)
}

const opts = dbUrlFromEnv(process.env)
const target = opts.url.startsWith('file:') ? `file (${opts.url})` : new URL(opts.url).host
console.log(`db:migrate targeting ${target}`)

try {
  const db = createDb(opts)
  await initDb(db, opts)
  await migrateDb(db, folder)
} finally {
  cleanup()
}

console.log('db:migrate complete')
