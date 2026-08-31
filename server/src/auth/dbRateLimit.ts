import { and, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { rateLimits } from '../db/schema.js'

const WINDOW_MS = 60 * 60 * 1000
const LIMITS: Record<'pin' | 'bind', number> = { pin: 10, bind: 20 }

export async function checkLimit(db: DbLike, scope: 'pin' | 'bind', key: string, nowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const row = await db.select().from(rateLimits).where(and(eq(rateLimits.scope, scope), eq(rateLimits.key, key))).get()

  if (!row) {
    await db.insert(rateLimits).values({ scope, key, windowStart: new Date(nowMs).toISOString(), count: 1 }).run()
    return { allowed: true, retryAfterSec: 0 }
  }

  const windowStartMs = Date.parse(row.windowStart)
  const stale = nowMs - windowStartMs >= WINDOW_MS
  const windowStart = stale ? new Date(nowMs).toISOString() : row.windowStart
  const count = stale ? 1 : row.count + 1

  // Two concurrent attempts can both read the same count and both be let through; that
  // last-attempt race is accepted at this scale rather than adding compare-and-swap.
  await db.update(rateLimits).set({ windowStart, count }).where(and(eq(rateLimits.scope, scope), eq(rateLimits.key, key))).run()

  if (count <= LIMITS[scope]) return { allowed: true, retryAfterSec: 0 }
  const windowEndMs = Date.parse(windowStart) + WINDOW_MS
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000)) }
}
