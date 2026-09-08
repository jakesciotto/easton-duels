import fs from 'node:fs'
import path from 'node:path'
import { applyDevDefaults } from './lib/env.js'

// The dev entry. It decides the database before the server entry loads .env, and the
// loader keeps a variable that is already set, so the local default survives it.
const local = applyDevDefaults(process.env)
if (local === null) {
  console.log('dev: remote database from .env (DUELS_DEV_REMOTE=1)')
} else {
  fs.mkdirSync(path.dirname(local), { recursive: true })
  console.log(`dev: local database ${local} (set DUELS_DEV_REMOTE=1 for the remote target)`)
}

await import('./index.js')
