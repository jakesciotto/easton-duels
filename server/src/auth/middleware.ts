import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Env } from '../context.js'
import { verifyToken } from './tokens.js'

type Status = 401 | 403 | 404 | 409 | 422 | 429 | 503

export function errorJson(c: Context, status: Status, code: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ error: { code, message, ...extra } }, status)
}

// Behind a proxy (Vercel) the TCP peer is the proxy, so every caller would share one
// rate-limit bucket; the forwarded headers carry the real client. On the LAN there is no
// proxy, so those same headers are attacker-controlled -- any device on the gym wifi could
// send a fresh x-forwarded-for on every request and never spend its own limiter budget.
// Only trust them when ctx.publicUrl marks this deployment as sitting behind one.
export function clientIp(c: Context<Env>): string {
  if (c.get('ctx').publicUrl) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
    const real = c.req.header('x-real-ip')?.trim()
    if (real) return real
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export const attachAuth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  c.set('auth', token ? verifyToken(token, c.get('ctx').secret) : null)
  await next()
})

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const auth = c.get('auth')
  if (!auth) return errorJson(c, 401, 'unauthorized', 'token required')
  if (auth.role !== 'admin') return errorJson(c, 403, 'forbidden', 'admin token required')
  await next()
})

export function requireMatOrAdmin(resolveMatId: (c: Context<Env>) => number | null | Promise<number | null>) {
  return createMiddleware<Env>(async (c, next) => {
    const auth = c.get('auth')
    if (!auth) return errorJson(c, 401, 'unauthorized', 'token required')
    if (auth.role === 'admin') return next()
    const matId = await resolveMatId(c)
    if (matId === null || auth.matId !== matId) return errorJson(c, 403, 'forbidden', 'token is for another mat')
    await next()
  })
}
