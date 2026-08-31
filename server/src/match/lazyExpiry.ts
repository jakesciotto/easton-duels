import { and, eq, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { matches } from '../db/schema.js'
import { bumpVersion } from './events.js'
import { expireClock } from './expiry.js'

// Live matches whose running clock has elapsed by nowMs still show 'live' in the
// matches table until something checks. Snapshot polls and scoring writes both call
// this before reading state, so an overdue clock is closed out lazily instead of by
// a background timer. expireClock re-checks each match's clock state inside its own
// transaction, so concurrent callers with the same nowMs write at most one event.
export async function expireOverdue(db: Db, eventId: number, nowMs: number): Promise<void> {
  const running = await db.select().from(matches)
    .where(and(eq(matches.eventId, eventId), eq(matches.status, 'live'), isNotNull(matches.clockStartedAt)))
    .all()
  const overdue = running.filter(m => Date.parse(m.clockStartedAt as string) + (m.lengthSec * 1000 - m.clockElapsedMs) <= nowMs)
  if (overdue.length === 0) return
  const atIso = new Date(nowMs).toISOString()
  let expired = false
  for (const m of overdue) {
    if (await expireClock(db, m.id, atIso)) expired = true
  }
  if (expired) await bumpVersion(db, eventId)
}
