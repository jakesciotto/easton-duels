import type { RosterConfig } from '../context.js'
import { WlClient } from './wl.js'

export function rosterFromEnv(env: Record<string, string | undefined>): RosterConfig {
  const wl = env.WL_CLIENT_ID && env.WL_CLIENT_SECRET && env.WL_BUSINESS
    ? new WlClient({ clientId: env.WL_CLIENT_ID, clientSecret: env.WL_CLIENT_SECRET, region: env.WL_REGION ?? '1', business: env.WL_BUSINESS, kidsCategory: env.WL_KIDS_CATEGORY || undefined })
    : null
  const leaderboard = env.LEADERBOARD_SUPABASE_URL && env.LEADERBOARD_SUPABASE_KEY
    ? { url: env.LEADERBOARD_SUPABASE_URL, key: env.LEADERBOARD_SUPABASE_KEY }
    : null
  return { wl, leaderboard }
}
