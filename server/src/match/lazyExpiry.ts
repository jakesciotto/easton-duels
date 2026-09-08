import { and, eq, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { matches } from '../db/schema.js'
import { bumpVersion } from './events.js'
import { effectiveLengthMs } from './derive.js'
import { expireClock, isBusy } from './expiry.js'
import { recordAudit } from '../audit/log.js'

// Live matches whose running clock has elapsed by nowMs still show 'live' in the
// matches table until something checks. Snapshot polls and scoring writes both call
// this before reading state, so an overdue clock is closed out lazily instead of by
// a background timer. The expiry events and the version bump commit in one transaction,
// so concurrent callers with the same nowMs write at most one event: the loser is
// refused the write lock and drops out.
export async function expireOverdue(db: Db, eventId: number, nowMs: number): Promise<void> {
  const running = await db.select().from(matches)
    .where(and(eq(matches.eventId, eventId), eq(matches.status, 'live'), isNotNull(matches.clockStartedAt)))
    .all()
  const overdue = running.filter(m => Date.parse(m.clockStartedAt as string) + (effectiveLengthMs(m) - m.clockElapsedMs) <= nowMs)
  if (overdue.length === 0) return
  const atIso = new Date(nowMs).toISOString()
  try {
    await db.transaction(async tx => {
      let expired = false
      for (const m of overdue) {
        const closed = await expireClock(tx, m.id, atIso)
        if (!closed) continue
        expired = true
        await recordAudit(tx, {
          eventId, matchId: closed.id, actor: 'system', action: 'clock_pause',
          detail: { seq: closed.lastSeq, expiry: true }, at: atIso,
        })
      }
      if (expired) await bumpVersion(tx, eventId)
    })
  } catch (e) {
    // A concurrent poller holds the write lock and is expiring the same clocks; its event
    // and its bump commit together, so dropping this attempt loses nothing.
    if (isBusy(e)) return
    throw e
  }
}
