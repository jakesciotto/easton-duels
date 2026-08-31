import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../context.js'
import { validate } from '../lib/validate.js'
import { clientIp, errorJson } from '../auth/middleware.js'
import { checkLimit } from '../auth/dbRateLimit.js'
import { pinMatches } from '../auth/pin.js'
import { signToken, tokenExpiry } from '../auth/tokens.js'

export const authRoutes = new Hono<Env>()

authRoutes.post('/auth/admin', validate('json', z.object({ pin: z.string() })), async c => {
  const ctx = c.get('ctx')
  const ip = clientIp(c)
  const limit = await checkLimit(ctx.db, 'pin', ip, Date.now())
  if (!limit.allowed) return errorJson(c, 429, 'rate_limited', 'too many attempts; wait a minute')
  const { pin } = c.req.valid('json')
  if (!pinMatches(pin, ctx.adminPin)) {
    return errorJson(c, 401, 'bad_pin', 'wrong PIN')
  }
  return c.json({ token: signToken({ role: 'admin', exp: tokenExpiry() }, ctx.secret) })
})
