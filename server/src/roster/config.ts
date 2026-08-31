import type { RosterConfig } from '../context.js'
import { WlClient } from './wl.js'

// `defaults.syncBudgetMs` is the cloud entry's fallback: a serverless function has a hard
// time limit, so the sync has to give up and answer before the platform kills it. LAN has
// no limit, so it passes nothing and the sync runs to completion.
export function rosterFromEnv(env: Record<string, string | undefined>, defaults: { syncBudgetMs?: number } = {}): RosterConfig {
  const maxPolls = Number(env.WL_SYNC_MAX_POLLS)
  const budget = Number(env.SYNC_DEADLINE_MS)
  const wl = env.WL_CLIENT_ID && env.WL_CLIENT_SECRET && env.WL_BUSINESS
    ? new WlClient(
        { clientId: env.WL_CLIENT_ID, clientSecret: env.WL_CLIENT_SECRET, region: env.WL_REGION ?? '1', business: env.WL_BUSINESS, kidsCategory: env.WL_KIDS_CATEGORY || undefined },
        Number.isInteger(maxPolls) && maxPolls > 0 ? { maxPolls } : {},
      )
    : null
  const leaderboard = env.LEADERBOARD_SUPABASE_URL && env.LEADERBOARD_SUPABASE_KEY
    ? { url: env.LEADERBOARD_SUPABASE_URL, key: env.LEADERBOARD_SUPABASE_KEY }
    : null
  return { wl, leaderboard, syncBudgetMs: Number.isInteger(budget) && budget > 0 ? budget : defaults.syncBudgetMs ?? null }
}
