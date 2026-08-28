import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, mats, matches, matchEvents, type MatchRow, type MatRow } from '../db/schema.js'
import { loadMatch, recompute, MatchStateError } from './events.js'
import type { WinType } from '../shared/types.js'

function loadMat(db: DbLike, matId: number): MatRow {
  const row = db.select().from(mats).where(eq(mats.id, matId)).get()
  if (!row) throw new MatchStateError('mat not found')
  return row
}

function hasScoringEvents(db: DbLike, matchId: number): boolean {
  return db.select({ id: matchEvents.id }).from(matchEvents)
    .where(and(eq(matchEvents.matchId, matchId), ne(matchEvents.type, 'admin'), ne(matchEvents.type, 'end'))).get() !== undefined
}

function adminEventId(matchId: number, seq: number): string {
  return `admin:${matchId}:${seq}`
}

export function startEvent(db: DbLike, eventId: number): void {
  db.transaction(tx => {
    const ev = tx.select().from(events).where(eq(events.id, eventId)).get()
    if (!ev) throw new MatchStateError('event not found')
    if (ev.status !== 'setup') throw new MatchStateError(`event is ${ev.status}`)
    tx.update(events).set({ status: 'live' }).where(eq(events.id, eventId)).run()
    for (const mat of tx.select().from(mats).where(eq(mats.eventId, eventId)).all()) advanceMat(tx, mat.id)
  })
}

export function advanceMat(db: DbLike, matId: number): MatchRow | null {
  return db.transaction(tx => {
    const mat = loadMat(tx, matId)
    const ev = tx.select().from(events).where(eq(events.id, mat.eventId)).get()
    if (!ev || ev.status !== 'live') return null
    if (mat.currentMatchId !== null) {
      const current = tx.select().from(matches).where(eq(matches.id, mat.currentMatchId)).get()
      if (current && current.status === 'live') return current
    }
    const next = tx.select().from(matches)
      .where(and(eq(matches.matId, matId), eq(matches.status, 'pending')))
      .orderBy(asc(matches.orderIndex)).get()
    if (!next) {
      tx.update(mats).set({ currentMatchId: null }).where(eq(mats.id, matId)).run()
      return null
    }
    tx.update(matches).set({ status: 'live' }).where(eq(matches.id, next.id)).run()
    tx.update(mats).set({ currentMatchId: next.id }).where(eq(mats.id, matId)).run()
    return loadMatch(tx, next.id)
  })
}

export function reopenMatch(db: DbLike, matchId: number): MatchRow {
  return db.transaction(tx => {
    const match = loadMatch(tx, matchId)
    if (match.status !== 'done') throw new MatchStateError('only a done match can be reopened')
    if (match.matId !== null) {
      const mat = loadMat(tx, match.matId)
      if (mat.currentMatchId !== null && mat.currentMatchId !== match.id) {
        const current = loadMatch(tx, mat.currentMatchId)
        if (current.status === 'live') {
          if (hasScoringEvents(tx, current.id)) throw new MatchStateError('the next match on this mat already started; edit the result instead')
          tx.update(matches).set({ status: 'pending' }).where(eq(matches.id, current.id)).run()
        }
      }
      tx.update(mats).set({ currentMatchId: match.id }).where(eq(mats.id, mat.id)).run()
    }
    const seq = match.lastSeq + 1
    tx.insert(matchEvents).values({ id: adminEventId(match.id, seq), matchId: match.id, seq, type: 'admin', payload: { kind: 'reopen' }, at: new Date().toISOString() }).run()
    return recompute(tx, match.id)
  })
}

export function setResult(db: DbLike, matchId: number, result: { winnerAthleteId: number; winType: WinType }): MatchRow {
  return db.transaction(tx => {
    const match = loadMatch(tx, matchId)
    if (match.status !== 'done') throw new MatchStateError('only a done match can have its result edited')
    if (result.winnerAthleteId !== match.athleteAId && result.winnerAthleteId !== match.athleteBId) throw new MatchStateError('athlete not in match')
    const seq = match.lastSeq + 1
    tx.insert(matchEvents).values({
      id: adminEventId(match.id, seq), matchId: match.id, seq, type: 'admin', athleteId: result.winnerAthleteId,
      payload: { kind: 'edit_result', ...result }, at: new Date().toISOString(),
    }).run()
    return recompute(tx, match.id)
  })
}

export function skipMatch(db: DbLike, matchId: number): MatchRow {
  return db.transaction(tx => {
    const match = loadMatch(tx, matchId)
    if (match.status === 'done') throw new MatchStateError('cannot skip a done match')
    if (hasScoringEvents(tx, match.id)) throw new MatchStateError('match has events; undo them before skipping')
    const max = tx.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), 0)` }).from(matches).where(eq(matches.eventId, match.eventId)).get()
    const seq = match.lastSeq + 1
    tx.insert(matchEvents).values({ id: adminEventId(match.id, seq), matchId: match.id, seq, type: 'admin', payload: { kind: 'skip' }, at: new Date().toISOString() }).run()
    tx.update(matches).set({ status: 'pending', orderIndex: (max?.m ?? 0) + 1, lastSeq: seq }).where(eq(matches.id, match.id)).run()
    if (match.matId !== null) {
      const mat = loadMat(tx, match.matId)
      if (mat.currentMatchId === match.id) advanceMat(tx, mat.id)
    }
    return loadMatch(tx, match.id)
  })
}
