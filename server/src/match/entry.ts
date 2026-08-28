import { and, asc, eq, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, rulesets, mats, matches, matchEvents, type MatchRow } from '../db/schema.js'
import { loadMatch, recompute, MatchStateError } from './events.js'
import { advanceMat } from './mats.js'
import { resolvePair } from './pairs.js'
import type { WinType } from '../shared/types.js'

export interface EntryInput {
  pointsA: number
  pointsB: number
  winnerAthleteId: number
  winType: WinType
  at?: string
}

export interface CreateEntryInput extends EntryInput {
  athleteAId: number
  athleteBId: number
  rulesetId?: number
}

type Insert = typeof matchEvents.$inferInsert

export function enterResult(db: DbLike, matchId: number, input: EntryInput): MatchRow {
  return db.transaction(tx => {
    const match = loadMatch(tx, matchId)
    if (input.winnerAthleteId !== match.athleteAId && input.winnerAthleteId !== match.athleteBId) throw new MatchStateError('athlete not in match')
    const at = input.at ?? new Date().toISOString()
    const wasDone = match.status === 'done'
    if (match.status === 'pending') tx.update(matches).set({ status: 'live' }).where(eq(matches.id, matchId)).run()

    let seq = match.lastSeq
    const rows: Insert[] = []
    const push = (row: Omit<Insert, 'id' | 'matchId' | 'seq' | 'at'>) => {
      const s = ++seq
      rows.push({ id: `entry:${matchId}:${s}`, matchId, seq: s, at, ...row })
    }
    if (match.clockStartedAt) push({ type: 'clock_pause' })
    push({ type: 'set_score', athleteId: match.athleteAId, points: input.pointsA })
    push({ type: 'set_score', athleteId: match.athleteBId, points: input.pointsB })
    const result = { winnerAthleteId: input.winnerAthleteId, winType: input.winType }
    if (wasDone) push({ type: 'admin', athleteId: result.winnerAthleteId, payload: { kind: 'edit_result', ...result } })
    else push({ type: 'end', athleteId: result.winnerAthleteId, payload: { kind: 'end', ...result } })
    tx.insert(matchEvents).values(rows).run()

    const updated = recompute(tx, matchId)
    if (updated.matId !== null) {
      const mat = tx.select().from(mats).where(eq(mats.id, updated.matId)).get()
      if (mat && mat.currentMatchId === matchId) advanceMat(tx, mat.id)
    }
    return loadMatch(tx, matchId)
  })
}

export function createEntry(db: DbLike, eventId: number, input: CreateEntryInput): MatchRow {
  return db.transaction(tx => {
    if (!tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) throw new MatchStateError('event not found')
    const pair = resolvePair(tx, eventId, input.athleteAId, input.athleteBId)
    if (typeof pair === 'string') throw new MatchStateError(pair)
    const existing = tx.select().from(matches)
      .where(and(eq(matches.eventId, eventId), eq(matches.status, 'pending'), eq(matches.athleteAId, pair.a), eq(matches.athleteBId, pair.b)))
      .orderBy(asc(matches.orderIndex)).get()
    let matchId: number
    if (existing) {
      matchId = existing.id
    } else {
      const ruleset = input.rulesetId !== undefined
        ? tx.select().from(rulesets).where(and(eq(rulesets.id, input.rulesetId), eq(rulesets.eventId, eventId))).get()
        : tx.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).get()
      if (!ruleset) throw new MatchStateError('ruleset not found')
      const max = tx.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), -1)` }).from(matches).where(eq(matches.eventId, eventId)).get()
      matchId = tx.insert(matches).values({
        eventId, athleteAId: pair.a, athleteBId: pair.b, rulesetId: ruleset.id, lengthSec: ruleset.defaultLengthSec,
        matId: null, orderIndex: (max?.m ?? -1) + 1, why: 'entered by hand',
      }).returning().get().id
    }
    return enterResult(tx, matchId, input)
  })
}
