import { and, eq, inArray, lt } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { mats } from '../db/schema.js'
import { bumpVersion, MatchStateError } from '../match/events.js'
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

// Binding is what settles who scores a mat, so it reads the mat's live state rather than
// the stored flag alone: a tablet whose heartbeats stopped more than the reap window ago
// has already lost the mat, whether or not a poll has swept it yet. Returns the epoch the
// caller's token must carry, or null when a tablet is still on the mat and the caller did
// not ask to take it over. Every successful bind mints the next epoch, so the token any
// earlier tablet still holds stops working the moment this one starts.
export async function bindMat(db: DbLike, matId: number, eventId: number, nowMs: number, takeOver: boolean): Promise<number | null> {
  return db.transaction(async tx => {
    const row = await tx.select().from(mats).where(eq(mats.id, matId)).get()
    if (!row) throw new MatchStateError('mat not found')
    const held = row.bound && row.lastHeartbeatAt !== null && Date.parse(row.lastHeartbeatAt) > nowMs - BOUND_WINDOW_MS
    if (held && !takeOver) return null
    const epoch = row.bindEpoch + 1
    await tx.update(mats).set({ bound: true, lastHeartbeatAt: new Date(nowMs).toISOString(), bindEpoch: epoch }).where(eq(mats.id, matId)).run()
    await bumpVersion(tx, eventId)
    return epoch
  })
}

// The tablet's own way off a mat. Without it a device that unbound locally kept the
// server's flag for the whole reap window, so the Live tab said "No scorer" a minute late
// and the same tablet re-entering the code was refused with a sentence about another iPad.
// The epoch moves so the token the tablet just dropped stops being accepted too.
export async function unbindMat(db: DbLike, matId: number, eventId: number): Promise<void> {
  await db.transaction(async tx => {
    const row = await tx.select({ bindEpoch: mats.bindEpoch }).from(mats).where(eq(mats.id, matId)).get()
    if (!row) throw new MatchStateError('mat not found')
    await tx.update(mats).set({ bound: false, lastHeartbeatAt: null, bindEpoch: row.bindEpoch + 1 }).where(eq(mats.id, matId)).run()
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
