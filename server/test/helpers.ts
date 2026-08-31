import { createApp } from '../src/app.js'
import type { AppContext } from '../src/context.js'
import { signToken, tokenExpiry } from '../src/auth/tokens.js'
import { freshDb } from './fixtures.js'

export const TEST_SECRET = 'test-secret'
export const TEST_PIN = '123456'

export async function createTestApp(overrides: Partial<AppContext> = {}) {
  const db = overrides.db ?? await freshDb()
  const ctx: AppContext = {
    port: 0, db, secret: TEST_SECRET, adminPin: TEST_PIN,
    roster: { wl: null, leaderboard: null },
    ...overrides,
  }
  const app = createApp(ctx)
  const adminToken = signToken({ role: 'admin', exp: tokenExpiry() }, TEST_SECRET)
  return { app, ctx, db, adminToken }
}

export function matToken(eventId: number, matId: number): string {
  return signToken({ role: 'mat', eventId, matId, exp: tokenExpiry() }, TEST_SECRET)
}

export async function call(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json as any }
}
