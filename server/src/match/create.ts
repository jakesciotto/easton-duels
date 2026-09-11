import { and, asc, eq, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { rulesets, mats, matches, type MatchRow } from '../db/schema.js'
import { resolvePair, leastLoadedMat } from './pairs.js'
import { advanceMat } from './mats.js'
import { bumpVersion } from './events.js'
import { recordAudit } from '../audit/log.js'
import type { MatchSource } from '../shared/types.js'

export interface CreateMatchInput {
  eventId: number
  athleteAId: number
  athleteBId: number
  rulesetId?: number
  lengthSec?: number
  matId?: number | null
  source: MatchSource
}

export type CreateMatchResult = { ok: true; match: MatchRow } | { ok: false; message: string }

/**
 * The one path a match comes into being on. The Add match dialog and a confirmed proposal
 * both run it, so the pair check, the least loaded mat, the next order slot, the ruleset's
 * length and the match_create row are written in one place rather than twice.
 *
 * `also` runs inside the same transaction as the insert, which is how a confirm deletes
 * its proposal with no moment where the draft and the match both exist.
 */
export async function createMatch(
  db: DbLike,
  input: CreateMatchInput,
  also?: (tx: DbLike, match: MatchRow) => Promise<void>,
): Promise<CreateMatchResult> {
  const { eventId } = input
  const pair = await resolvePair(db, eventId, input.athleteAId, input.athleteBId)
  if (typeof pair === 'string') return { ok: false, message: pair }
  const ruleset = input.rulesetId !== undefined
    ? await db.select().from(rulesets).where(and(eq(rulesets.id, input.rulesetId), eq(rulesets.eventId, eventId))).get()
    : await db.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).get()
  if (!ruleset) return { ok: false, message: 'ruleset is not on this event' }
  if (input.matId !== undefined && input.matId !== null
    && !await db.select({ id: mats.id }).from(mats).where(and(eq(mats.id, input.matId), eq(mats.eventId, eventId))).get()) {
    return { ok: false, message: 'mat is not on this event' }
  }
  const max = await db.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), -1)` }).from(matches).where(eq(matches.eventId, eventId)).get()
  const matId = input.matId === undefined ? await leastLoadedMat(db, eventId) : input.matId
  const match = await db.transaction(async tx => {
    const inserted = await tx.insert(matches).values({
      eventId, athleteAId: pair.a, athleteBId: pair.b, rulesetId: ruleset.id,
      lengthSec: input.lengthSec ?? ruleset.defaultLengthSec,
      matId,
      orderIndex: (max?.m ?? -1) + 1,
      source: input.source,
    }).returning().get()
    // An idle mat has nothing to advance it, so on a live event scored on the mats the new
    // match starts there. advanceMat is a no-op in setup, in desk mode, and on a mat that
    // already has a live match.
    if (matId !== null) await advanceMat(tx, matId, 'admin')
    await recordAudit(tx, {
      eventId, matchId: inserted.id, actor: 'admin', action: 'match_create',
      detail: {
        athleteAId: inserted.athleteAId, athleteBId: inserted.athleteBId,
        matId: inserted.matId, orderIndex: inserted.orderIndex, source: inserted.source,
      },
    })
    await also?.(tx, inserted)
    await bumpVersion(tx, eventId)
    return inserted
  })
  return { ok: true, match }
}
