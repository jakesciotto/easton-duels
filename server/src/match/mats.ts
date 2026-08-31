import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, mats, matches, matchEvents, type MatchRow, type MatRow } from '../db/schema.js'
import { loadMatch, recompute, MatchStateError } from './events.js'
import type { WinType } from '../shared/types.js'

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

export async function startEvent(db: DbLike, eventId: number): Promise<void> {
  await db.transaction(async tx => {
    const ev = await tx.select().from(events).where(eq(events.id, eventId)).get()
    if (!ev) throw new MatchStateError('event not found')
    if (ev.status !== 'setup') throw new MatchStateError(`event is ${ev.status}`)
    await tx.update(events).set({ status: 'live' }).where(eq(events.id, eventId)).run()
    for (const mat of await tx.select().from(mats).where(eq(mats.eventId, eventId)).all()) await advanceMat(tx, mat.id)
  })
}

export async function advanceMat(db: DbLike, matId: number): Promise<MatchRow | null> {
  return db.transaction(async tx => {
    const mat = await loadMat(tx, matId)
    const ev = await tx.select().from(events).where(eq(events.id, mat.eventId)).get()
    if (!ev || ev.status !== 'live') return null
    if (mat.currentMatchId !== null) {
      const current = await tx.select().from(matches).where(eq(matches.id, mat.currentMatchId)).get()
      if (current && current.status === 'live') return current
    }
    const next = await tx.select().from(matches)
      .where(and(eq(matches.matId, matId), eq(matches.status, 'pending')))
      .orderBy(asc(matches.orderIndex)).get()
    if (!next) {
      await tx.update(mats).set({ currentMatchId: null }).where(eq(mats.id, matId)).run()
      return null
    }
    await tx.update(matches).set({ status: 'live' }).where(eq(matches.id, next.id)).run()
    await tx.update(mats).set({ currentMatchId: next.id }).where(eq(mats.id, matId)).run()
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

export async function setResult(db: DbLike, matchId: number, result: { winnerAthleteId: number; winType: WinType }): Promise<MatchRow> {
  return db.transaction(async tx => {
    const match = await loadMatch(tx, matchId)
    if (match.status !== 'done') throw new MatchStateError('only a done match can have its result edited')
    if (result.winnerAthleteId !== match.athleteAId && result.winnerAthleteId !== match.athleteBId) throw new MatchStateError('athlete not in match')
    const seq = match.lastSeq + 1
    await tx.insert(matchEvents).values({
      id: adminEventId(match.id, seq), matchId: match.id, seq, type: 'admin', athleteId: result.winnerAthleteId,
      payload: { kind: 'edit_result', ...result }, at: new Date().toISOString(),
    }).run()
    return recompute(tx, match.id)
  })
}

export async function skipMatch(db: DbLike, matchId: number): Promise<MatchRow> {
  return db.transaction(async tx => {
    const match = await loadMatch(tx, matchId)
    if (match.status === 'done') throw new MatchStateError('cannot skip a done match')
    if (await hasScoringEvents(tx, match.id)) throw new MatchStateError('match has events; undo them before skipping')
    const max = await tx.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), 0)` }).from(matches).where(eq(matches.eventId, match.eventId)).get()
    const seq = match.lastSeq + 1
    await tx.insert(matchEvents).values({ id: adminEventId(match.id, seq), matchId: match.id, seq, type: 'admin', payload: { kind: 'skip' }, at: new Date().toISOString() }).run()
    await tx.update(matches).set({ status: 'pending', orderIndex: (max?.m ?? 0) + 1, lastSeq: seq }).where(eq(matches.id, match.id)).run()
    if (match.matId !== null) {
      const mat = await loadMat(tx, match.matId)
      if (mat.currentMatchId === match.id) await advanceMat(tx, mat.id)
    }
    return loadMatch(tx, match.id)
  })
}
