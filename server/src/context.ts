import type { Db } from './db/client.js'
import type { TokenPayload } from './auth/tokens.js'
import type { RateLimiter } from './auth/rateLimit.js'

export interface AppContext {
  port: number
  db: Db
  secret: string
  adminPin: string
  limiter: RateLimiter
}

export type Env = { Variables: { ctx: AppContext; auth: TokenPayload | null } }
