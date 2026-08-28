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
