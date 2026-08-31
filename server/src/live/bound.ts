import { and, eq, inArray, lt } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { mats } from '../db/schema.js'
import { bumpVersion } from '../match/events.js'
import { isBusy } from '../match/expiry.js'

export const BOUND_WINDOW_MS = 60_000

export async function heartbeatMat(db: DbLike, matId: number, eventId: number, nowMs: number): Promise<void> {
  const row = await db.select({ bound: mats.bound }).from(mats).where(eq(mats.id, matId)).get()
  const at = new Date(nowMs).toISOString()
  const touch = (tx: DbLike) => tx.update(mats).set({ lastHeartbeatAt: at, bound: true }).where(eq(mats.id, matId)).run()
  if (!row || row.bound) {
    await touch(db)
    return
  }
  await db.transaction(async tx => {
    await touch(tx)
    await bumpVersion(tx, eventId)
  })
}

export async function reapBound(db: DbLike, eventId: number, nowMs: number): Promise<void> {
  const cutoff = new Date(nowMs - BOUND_WINDOW_MS).toISOString()
  const stale = await db.select({ id: mats.id }).from(mats)
    .where(and(eq(mats.eventId, eventId), eq(mats.bound, true), lt(mats.lastHeartbeatAt, cutoff))).all()
  if (stale.length === 0) return
  try {
    await db.transaction(async tx => {
      // The cutoff is repeated in the UPDATE so a heartbeat landing between the two
      // statements is not clobbered back to unbound, and matched zero rows means it
      // won that race -- nothing changed, so nothing to bump.
      const r = await tx.update(mats).set({ bound: false })
        .where(and(inArray(mats.id, stale.map(m => m.id)), lt(mats.lastHeartbeatAt, cutoff))).run()
      if (r.rowsAffected > 0) await bumpVersion(tx, eventId)
    })
  } catch (e) {
    // A concurrent poller holds the write lock, most likely expiring the same event's
    // clocks or reaping the same mats; the next poll retries and loses nothing.
    if (isBusy(e)) return
    throw e
  }
}
