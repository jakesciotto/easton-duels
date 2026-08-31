import { and, eq, inArray, lt } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { mats } from '../db/schema.js'
import { bumpVersion } from '../match/events.js'

export const BOUND_WINDOW_MS = 60_000

export async function heartbeatMat(db: DbLike, matId: number, eventId: number, nowMs: number): Promise<void> {
  const row = await db.select({ bound: mats.bound }).from(mats).where(eq(mats.id, matId)).get()
  await db.update(mats).set({ lastHeartbeatAt: new Date(nowMs).toISOString(), bound: true }).where(eq(mats.id, matId)).run()
  if (row && !row.bound) await bumpVersion(db, eventId)
}

export async function reapBound(db: DbLike, eventId: number, nowMs: number): Promise<void> {
  const cutoff = new Date(nowMs - BOUND_WINDOW_MS).toISOString()
  const stale = await db.select({ id: mats.id }).from(mats)
    .where(and(eq(mats.eventId, eventId), eq(mats.bound, true), lt(mats.lastHeartbeatAt, cutoff))).all()
  if (stale.length === 0) return
  await db.update(mats).set({ bound: false }).where(inArray(mats.id, stale.map(m => m.id))).run()
  await bumpVersion(db, eventId)
}
