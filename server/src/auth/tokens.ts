import { createHmac, timingSafeEqual } from 'node:crypto'

export type TokenPayload =
  | { role: 'admin'; exp: number }
  | { role: 'mat'; eventId: number; matId: number; exp: number }

export const TOKEN_TTL_SEC = 24 * 3600

export function tokenExpiry(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + TOKEN_TTL_SEC
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body, secret)}`
}

export function verifyToken(token: string, secret: string, nowMs = Date.now()): TokenPayload | null {
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const sig = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(body, secret))
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null
    if (payload.role !== 'admin' && payload.role !== 'mat') return null
    return payload
  } catch {
    return null
  }
}
