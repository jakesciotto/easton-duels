import type { Db } from './db/client.js'
import type { TokenPayload } from './auth/tokens.js'
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
  roster: RosterConfig
  publicUrl?: string
}

export type Env = { Variables: { ctx: AppContext; auth: TokenPayload | null } }
