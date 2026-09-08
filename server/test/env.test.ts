import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadDotEnv } from '../src/lib/env.js'

const dir = mkdtempSync(path.join(tmpdir(), 'duels-env-test-'))
const file = path.join(dir, '.env')
writeFileSync(file, 'ADMIN_PIN=654321\n')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadDotEnv', () => {
  it('sets a var from the file when it was unset', () => {
    delete process.env.ADMIN_PIN
    loadDotEnv(file)
    expect(process.env.ADMIN_PIN).toBe('654321')
    delete process.env.ADMIN_PIN
  })

  it('does not change a var that was already set', () => {
    process.env.ADMIN_PIN = '111111'
    loadDotEnv(file)
    expect(process.env.ADMIN_PIN).toBe('111111')
    delete process.env.ADMIN_PIN
  })

  it('ignores a missing file', () => {
    expect(() => loadDotEnv(path.join(dir, 'does-not-exist.env'))).not.toThrow()
  })
})


describe('applyDevDefaults', () => {
  it('points the dev server at a local file when nothing says otherwise', () => {
    const env: Record<string, string | undefined> = { TURSO_DATABASE_URL: 'libsql://duels-example.turso.io' }
    expect(applyDevDefaults(env)).toBe(DEV_DB_PATH)
    expect(env.DB_PATH).toBe(DEV_DB_PATH)
  })
  it('keeps an explicit DB_PATH', () => {
    const env: Record<string, string | undefined> = { DB_PATH: './data/other.db' }
    expect(applyDevDefaults(env)).toBe('./data/other.db')
  })
  it('keeps the remote target only when the operator opts in', () => {
    const env: Record<string, string | undefined> = { DUELS_DEV_REMOTE: '1', TURSO_DATABASE_URL: 'libsql://duels-example.turso.io' }
    expect(applyDevDefaults(env)).toBeNull()
    expect(env.DB_PATH).toBeUndefined()
  })
})
