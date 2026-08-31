import { and, eq, inArray, lt } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { mats } from '../db/schema.js'
import { bumpVersion } from '../match/events.js'

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
  // The cutoff is repeated in the UPDATE so a heartbeat landing between the two
  // statements is not clobbered back to unbound.
  await db.transaction(async tx => {
    await tx.update(mats).set({ bound: false })
      .where(and(inArray(mats.id, stale.map(m => m.id)), lt(mats.lastHeartbeatAt, cutoff))).run()
    await bumpVersion(tx, eventId)
  })
}
