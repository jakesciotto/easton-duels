import { LibsqlError } from '@libsql/client'
import type { DbLike } from '../db/client.js'
import type { MatchRow } from '../db/schema.js'
import { appendMatchEvent, loadMatch, MatchStateError, SeqConflict } from './events.js'

// True when another writer holds the write lock. The caller's own transaction boundary
// (expireOverdue, reapBound) is what can actually contend for it; a poll that loses the
// race simply retries on the next one.
export function isBusy(e: unknown): boolean {
  return e instanceof LibsqlError && e.code === 'SQLITE_BUSY'
}

// Returns the match when it wrote the expiry pause, null when nothing needed writing.
export async function expireClock(db: DbLike, matchId: number, atIso: string): Promise<MatchRow | null> {
  const match = await loadMatch(db, matchId)
  if (match.status !== 'live' || !match.clockStartedAt) return null
  try {
    const r = await appendMatchEvent(db, { id: `expiry:${matchId}:${match.lastSeq}`, matchId, type: 'clock_pause', lastSeq: match.lastSeq, at: atIso })
    return r.duplicate ? null : r.match
  } catch (e) {
    if (e instanceof SeqConflict || e instanceof MatchStateError) return null
    throw e
  }
}
