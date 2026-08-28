import { and, eq, isNotNull } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { matches, type MatchRow } from '../db/schema.js'
import { appendMatchEvent, loadMatch, MatchStateError, SeqConflict } from './events.js'

export type ExpireHandler = (matchId: number, atIso: string) => void

export class ExpiryScheduler {
  private timers = new Map<number, NodeJS.Timeout>()

  constructor(private readonly onExpire: ExpireHandler, private readonly now: () => number = Date.now) {}

  schedule(matchId: number, expiresAtMs: number): void {
    this.cancel(matchId)
    const delay = Math.max(0, expiresAtMs - this.now())
    const timer = setTimeout(() => {
      this.timers.delete(matchId)
      this.onExpire(matchId, new Date(expiresAtMs).toISOString())
    }, delay)
    this.timers.set(matchId, timer)
  }

  cancel(matchId: number): void {
    const timer = this.timers.get(matchId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(matchId)
    }
  }

  sync(match: MatchRow): void {
    if (match.status === 'live' && match.clockStartedAt) {
      this.schedule(match.id, Date.parse(match.clockStartedAt) + (match.lengthSec * 1000 - match.clockElapsedMs))
    } else {
      this.cancel(match.id)
    }
  }

  rebuild(db: DbLike): void {
    const running = db.select().from(matches).where(and(eq(matches.status, 'live'), isNotNull(matches.clockStartedAt))).all()
    for (const m of running) this.sync(m)
  }

  clear(): void {
    for (const id of [...this.timers.keys()]) this.cancel(id)
  }

  pendingCount(): number {
    return this.timers.size
  }
}

// Returns the match when it wrote the expiry pause, null when nothing needed writing.
export function expireClock(db: DbLike, matchId: number, atIso: string): MatchRow | null {
  const match = loadMatch(db, matchId)
  if (match.status !== 'live' || !match.clockStartedAt) return null
  try {
    const r = appendMatchEvent(db, { id: `expiry:${matchId}:${match.lastSeq}`, matchId, type: 'clock_pause', lastSeq: match.lastSeq, at: atIso })
    return r.duplicate ? null : r.match
  } catch (e) {
    if (e instanceof SeqConflict || e instanceof MatchStateError) return null
    throw e
  }
}
