import type { Db } from './db/client.js'
import type { TokenPayload } from './auth/tokens.js'
import type { RateLimiter } from './auth/rateLimit.js'
import type { Hub } from './live/hub.js'
import type { ExpiryScheduler } from './match/expiry.js'
import type { WlLike, LeaderboardConfig } from './roster/types.js'

export interface RosterConfig {
  wl: WlLike | null
  leaderboard: LeaderboardConfig | null
}

export interface AppContext {
  port: number
  db: Db
  secret: string
  adminPin: string
  limiter: RateLimiter
  hub: Hub
  expiry: ExpiryScheduler
  roster: RosterConfig
}

export type Env = { Variables: { ctx: AppContext; auth: TokenPayload | null } }
