import { and, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { rateLimits } from '../db/schema.js'

const WINDOW_MS = 60 * 60 * 1000
const LIMITS: Record<LimitScope, number> = { pin: 10, bind: 20 }

export type LimitScope = 'pin' | 'bind'

function where(scope: LimitScope, key: string) {
  return and(eq(rateLimits.scope, scope), eq(rateLimits.key, key))
}

// Only a failed attempt spends the budget, so a room full of organizers signing in
// correctly can never lock itself out. checkLimit reads; recordFailure charges.
export async function checkLimit(db: DbLike, scope: LimitScope, key: string, nowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const row = await db.select().from(rateLimits).where(where(scope, key)).get()
  if (!row) return { allowed: true, retryAfterSec: 0 }
  const windowEndMs = Date.parse(row.windowStart) + WINDOW_MS
  if (nowMs >= windowEndMs || row.count < LIMITS[scope]) return { allowed: true, retryAfterSec: 0 }
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000)) }
}

export async function recordFailure(db: DbLike, scope: LimitScope, key: string, nowMs: number): Promise<void> {
  const row = await db.select().from(rateLimits).where(where(scope, key)).get()
  if (!row) {
    await db.insert(rateLimits).values({ scope, key, windowStart: new Date(nowMs).toISOString(), count: 1 }).run()
    return
  }
  const stale = nowMs - Date.parse(row.windowStart) >= WINDOW_MS
  // Two concurrent failures can both read the same count and both write count + 1 once;
  // that last-attempt race is accepted at this scale rather than adding compare-and-swap.
  await db.update(rateLimits).set({
    windowStart: stale ? new Date(nowMs).toISOString() : row.windowStart,
    count: stale ? 1 : row.count + 1,
  }).where(where(scope, key)).run()
}
