import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, mats, matches, matchEvents, type MatchRow, type MatRow } from '../db/schema.js'
import { loadMatch, recompute, MatchStateError } from './events.js'
import { recordAudit } from '../audit/log.js'
import type { AuditActor } from '../shared/types.js'

async function loadMat(db: DbLike, matId: number): Promise<MatRow> {
  const row = await db.select().from(mats).where(eq(mats.id, matId)).get()
  if (!row) throw new MatchStateError('mat not found')
  return row
}

async function hasScoringEvents(db: DbLike, matchId: number): Promise<boolean> {
  return await db.select({ id: matchEvents.id }).from(matchEvents)
    .where(and(eq(matchEvents.matchId, matchId), ne(matchEvents.type, 'admin'), ne(matchEvents.type, 'end'))).get() !== undefined
}

function adminEventId(matchId: number, seq: number): string {
  return `admin:${matchId}:${seq}`
}

// Skip and edit result are single taps on gym wifi, so the same press can arrive twice.
// A client id makes the second arrival a read: without it a double-fired Skip moved the
// match to the end of the order twice and advanced the mat past a pair nobody fought.
function clientAdminEventId(id: string): string {
  return `admin:${id}`
}

export interface AdminWriteResult { duplicate: boolean; match: MatchRow }

async function replayedAdmin(db: DbLike, id: string | undefined): Promise<AdminWriteResult | null> {
  if (id === undefined) return null
  const row = await db.select({ matchId: matchEvents.matchId }).from(matchEvents).where(eq(matchEvents.id, clientAdminEventId(id))).get()
  return row ? { duplicate: true, match: await loadMatch(db, row.matchId) } : null
}

export async function startEvent(db: DbLike, eventId: number): Promise<void> {
  await db.transaction(async tx => {
    const ev = await tx.select().from(events).where(eq(events.id, eventId)).get()
    if (!ev) throw new MatchStateError('event not found')
    if (ev.status !== 'setup') throw new MatchStateError(`event is ${ev.status}`)
    await tx.update(events).set({ status: 'live' }).where(eq(events.id, eventId)).run()
    // Organizers design matches in entry mode too, because the list is the running order.
    // Nothing scores those mats, so loading one would leave a match live all afternoon and
    // the desk's typed result would land on a second copy of the same pair.
    if (ev.mode !== 'live') return
    for (const mat of await tx.select().from(mats).where(eq(mats.eventId, eventId)).all()) await advanceMat(tx, mat.id, 'system')
  })
}

/**
 * The mode gate lives here rather than at each caller, because every path that loads a mat
 * runs through this one function: Start, the end of a match, a skip, a typed entry, the
 * Live panel's advance, and a match created or moved onto the mat. Only Start checked the
 * mode, so a match added to a live desk event went live on a mat that nothing scores and
 * left every desk list that hides the live lane.
 *
 * In desk mode no match is ever loaded. A match already live on a mat stays there, because
 * that is a switch to the desk taken mid-bout and the desk still has to type its result;
 * once that result settles, the next call releases the mat rather than naming a finished
 * pair for the rest of the afternoon.
 *
 * Every call that actually loads a match records its own `advance` row, so the actor is a
 * required argument rather than something guessed here from context: only the caller knows
 * whether Start, an admin, a desk entry, or the mat that just ended the previous bout is the
 * one responsible for the mat moving on.
 */
export async function advanceMat(db: DbLike, matId: number, actor: AuditActor): Promise<MatchRow | null> {
  return db.transaction(async tx => {
    const mat = await loadMat(tx, matId)
    const ev = await tx.select().from(events).where(eq(events.id, mat.eventId)).get()
    if (!ev || ev.status !== 'live') return null
    const current = mat.currentMatchId === null
      ? undefined
      : await tx.select().from(matches).where(eq(matches.id, mat.currentMatchId)).get()
    if (ev.mode !== 'live') {
      if (mat.currentMatchId !== null && current?.status !== 'live') {
        await tx.update(mats).set({ currentMatchId: null }).where(eq(mats.id, matId)).run()
      }
      return null
    }
    if (current && current.status === 'live') return current
    const next = await tx.select().from(matches)
      .where(and(eq(matches.matId, matId), eq(matches.status, 'pending')))
      .orderBy(asc(matches.orderIndex)).get()
    if (!next) {
      await tx.update(mats).set({ currentMatchId: null }).where(eq(mats.id, matId)).run()
      return null
    }
    await tx.update(matches).set({ status: 'live' }).where(eq(matches.id, next.id)).run()
    await tx.update(mats).set({ currentMatchId: next.id }).where(eq(mats.id, matId)).run()
    await recordAudit(tx, { eventId: mat.eventId, matchId: next.id, actor, action: 'advance', detail: { matId, matNumber: mat.number } })
    return loadMatch(tx, next.id)
  })
}

export async function reopenMatch(db: DbLike, matchId: number): Promise<MatchRow> {
  return db.transaction(async tx => {
    const match = await loadMatch(tx, matchId)
    const ev = await tx.select({ status: events.status }).from(events).where(eq(events.id, match.eventId)).get()
    if (!ev) throw new MatchStateError('event not found')
    if (ev.status === 'setup') throw new MatchStateError('start the event before reopening a match')
    if (match.status !== 'done') throw new MatchStateError('only a done match can be reopened')
    if (match.matId !== null) {
      const mat = await loadMat(tx, match.matId)
      if (mat.currentMatchId !== null && mat.currentMatchId !== match.id) {
        const current = await loadMatch(tx, mat.currentMatchId)
        if (current.status === 'live') {
          if (await hasScoringEvents(tx, current.id)) throw new MatchStateError('the next match on this mat already started; edit the result instead')
          await tx.update(matches).set({ status: 'pending' }).where(eq(matches.id, current.id)).run()
        }
      }
      await tx.update(mats).set({ currentMatchId: match.id }).where(eq(mats.id, mat.id)).run()
    }
    const seq = match.lastSeq + 1
    await tx.insert(matchEvents).values({ id: adminEventId(match.id, seq), matchId: match.id, seq, type: 'admin', payload: { kind: 'reopen' }, at: new Date().toISOString() }).run()
    return recompute(tx, match.id)
  })
}

export async function skipMatch(db: DbLike, matchId: number, id?: string): Promise<AdminWriteResult> {
  return db.transaction(async tx => {
    const replay = await replayedAdmin(tx, id)
    if (replay) return replay
    const match = await loadMatch(tx, matchId)
    if (match.status === 'done') throw new MatchStateError('cannot skip a done match')
    if (await hasScoringEvents(tx, match.id)) throw new MatchStateError('match has events; undo them before skipping. End it from the Live tab, then edit the result.')
    const max = await tx.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), 0)` }).from(matches).where(eq(matches.eventId, match.eventId)).get()
    const seq = match.lastSeq + 1
    await tx.insert(matchEvents).values({ id: id === undefined ? adminEventId(match.id, seq) : clientAdminEventId(id), matchId: match.id, seq, type: 'admin', payload: { kind: 'skip' }, at: new Date().toISOString() }).run()
    await tx.update(matches).set({ status: 'pending', orderIndex: (max?.m ?? 0) + 1, lastSeq: seq }).where(eq(matches.id, match.id)).run()
    if (match.matId !== null) {
      const mat = await loadMat(tx, match.matId)
      // Skip is admin-only (the only route that reaches it requires an admin token), so the
      // mat it advances on the way out is attributed to the same actor as the skip itself.
      if (mat.currentMatchId === match.id) await advanceMat(tx, mat.id, 'admin')
    }
    return { duplicate: false, match: await loadMatch(tx, match.id) }
  })
}
