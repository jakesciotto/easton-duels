import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, rulesets, mats, matches, matchEvents, type MatchRow } from '../db/schema.js'
import { loadMatch, recompute, MatchStateError } from './events.js'
import { advanceMat } from './mats.js'
import { resolvePair } from './pairs.js'
import type { WinType } from '../shared/types.js'

export interface EntryInput {
  entryId: string
  pointsA: number
  pointsB: number
  winnerAthleteId: number
  winType: WinType
  // Only a correction keeps this: a first result has nothing to explain, and the payload
  // it writes is an end rather than an edit_result.
  reason?: string
  at?: string
}

export interface CreateEntryInput extends EntryInput {
  athleteAId: number
  athleteBId: number
  rulesetId?: number
}

// `created` is set only by createEntry, and says whether the pair had no open match and
// one was made for it. The audit row for an entry carries it.
export interface EntryResult { duplicate: boolean; match: MatchRow; created?: boolean }

type Insert = typeof matchEvents.$inferInsert

const entryKey = (entryId: string) => `entry:${entryId}`

async function replayed(db: DbLike, entryId: string): Promise<EntryResult | null> {
  const row = await db.select().from(matchEvents).where(eq(matchEvents.id, entryKey(entryId))).get()
  return row ? { duplicate: true, match: await loadMatch(db, row.matchId) } : null
}

// The board has already announced the final score, so a stray keystroke at the desk must
// not move it. A replay of an entry taken before Finish still answers, because it changes
// nothing. Setup and live both stay open: entries are how a rehearsal is filled in.
async function assertEventOpen(db: DbLike, eventId: number): Promise<void> {
  const ev = await db.select({ status: events.status }).from(events).where(eq(events.id, eventId)).get()
  if (!ev) throw new MatchStateError('event not found')
  if (ev.status === 'done') throw new MatchStateError('event is done')
}

export async function enterResult(db: DbLike, matchId: number, input: EntryInput): Promise<EntryResult> {
  return db.transaction(async tx => {
    const replay = await replayed(tx, input.entryId)
    if (replay) return replay
    const match = await loadMatch(tx, matchId)
    await assertEventOpen(tx, match.eventId)
    if (input.winnerAthleteId !== match.athleteAId && input.winnerAthleteId !== match.athleteBId) throw new MatchStateError('athlete not in match')
    const at = input.at ?? new Date().toISOString()
    const wasDone = match.status === 'done'
    if (match.status === 'pending') await tx.update(matches).set({ status: 'live' }).where(eq(matches.id, matchId)).run()

    let seq = match.lastSeq
    const rows: Insert[] = []
    const push = (row: Omit<Insert, 'id' | 'matchId' | 'seq' | 'at'>) => {
      const s = ++seq
      rows.push({ id: rows.length === 0 ? entryKey(input.entryId) : `${entryKey(input.entryId)}:${s}`, matchId, seq: s, at, ...row })
    }
    if (match.clockStartedAt) push({ type: 'clock_pause' })
    push({ type: 'set_score', athleteId: match.athleteAId, points: input.pointsA })
    push({ type: 'set_score', athleteId: match.athleteBId, points: input.pointsB })
    const result = { winnerAthleteId: input.winnerAthleteId, winType: input.winType }
    const reason = input.reason ? { reason: input.reason } : {}
    if (wasDone) push({ type: 'admin', athleteId: result.winnerAthleteId, payload: { kind: 'edit_result', ...result, ...reason } })
    else push({ type: 'end', athleteId: result.winnerAthleteId, payload: { kind: 'end', ...result } })
    await tx.insert(matchEvents).values(rows).run()

    const updated = await recompute(tx, matchId)
    if (updated.matId !== null) {
      const mat = await tx.select().from(mats).where(eq(mats.id, updated.matId)).get()
      if (mat && mat.currentMatchId === matchId) await advanceMat(tx, mat.id)
    }
    return { duplicate: false, match: await loadMatch(tx, matchId) }
  })
}

// The desk types a result for a pair, not for a match id, so the pair has to resolve to
// whatever match already holds it. A live one counts: in live mode the mats load the first
// designed pair, and the desk is the fallback when a tablet fails. Preferring the match a
// mat is currently showing means that entry ends the match on that mat rather than a
// duplicate, and the mat then advances.
async function findOpenMatch(db: DbLike, eventId: number, pair: { a: number; b: number }): Promise<MatchRow | undefined> {
  const open = await db.select().from(matches)
    .where(and(
      eq(matches.eventId, eventId), inArray(matches.status, ['pending', 'live']),
      eq(matches.athleteAId, pair.a), eq(matches.athleteBId, pair.b),
    ))
    .orderBy(asc(matches.orderIndex)).all()
  if (open.length === 0) return undefined
  const matRows = await db.select({ currentMatchId: mats.currentMatchId }).from(mats).where(eq(mats.eventId, eventId)).all()
  const onMat = new Set(matRows.map(m => m.currentMatchId).filter((id): id is number => id !== null))
  return open.find(m => onMat.has(m.id)) ?? open.find(m => m.status === 'live') ?? open[0]
}

export async function createEntry(db: DbLike, eventId: number, input: CreateEntryInput): Promise<EntryResult> {
  return db.transaction(async tx => {
    const replay = await replayed(tx, input.entryId)
    if (replay) return replay
    await assertEventOpen(tx, eventId)
    const pair = await resolvePair(tx, eventId, input.athleteAId, input.athleteBId)
    if (typeof pair === 'string') throw new MatchStateError(pair)
    const existing = await findOpenMatch(tx, eventId, pair)
    let matchId: number
    if (existing) {
      matchId = existing.id
    } else {
      const ruleset = input.rulesetId !== undefined
        ? await tx.select().from(rulesets).where(and(eq(rulesets.id, input.rulesetId), eq(rulesets.eventId, eventId))).get()
        : await tx.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).get()
      if (!ruleset) throw new MatchStateError('ruleset not found')
      const max = await tx.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), -1)` }).from(matches).where(eq(matches.eventId, eventId)).get()
      matchId = (await tx.insert(matches).values({
        eventId, athleteAId: pair.a, athleteBId: pair.b, rulesetId: ruleset.id, lengthSec: ruleset.defaultLengthSec,
        matId: null, orderIndex: (max?.m ?? -1) + 1, why: 'entered by hand',
      }).returning().get()).id
    }
    return { ...await enterResult(tx, matchId, input), created: existing === undefined }
  })
}
