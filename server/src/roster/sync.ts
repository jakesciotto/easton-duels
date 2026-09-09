import { asc, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { athletes, rosterCandidates, type AthleteRow } from '../db/schema.js'
import { buildCandidates } from './join.js'
import { fullName, linkUpdate } from './link.js'
import { exactName, nameScore, SUGGEST_FLOOR, SUGGEST_MARGIN } from '../shared/similarity.js'
import { recordAudit } from '../audit/log.js'
import { bumpVersion } from '../match/events.js'
import type { LeaderboardCompetitor, WlBeltRecord } from './types.js'
import type { SyncChanges, SyncReport, SyncSuggestion } from '../shared/types.js'

type AthleteUpdate = Partial<typeof athletes.$inferInsert>
type ProfileFields = Partial<Pick<AthleteRow, 'belt' | 'erp' | 'age' | 'weightLbs' | 'gender' | 'wlLocation' | 'promotedAt'>>

// The seven fields a person reads off the profile. Everything else a sync writes is
// bookkeeping: the uid it linked on, the sources it set, the time it ran.
const PROFILE_FIELDS = ['belt', 'erp', 'age', 'weightLbs', 'gender', 'wlLocation', 'promotedAt'] as const

/**
 * What one refresh moved. Only the fields the update actually carries are compared, so a
 * value the candidate left alone (a hand typed age, a belt WellnessLiving has no answer
 * for) is not reported as a change to null.
 */
export function profileChanges(before: ProfileFields, after: ProfileFields): SyncChanges {
  const changes: SyncChanges = {}
  for (const field of PROFILE_FIELDS) {
    const to = after[field]
    if (to === undefined) continue
    const from = before[field] ?? null
    if (from !== to) changes[field] = { from, to }
  }
  return changes
}

// What the route knows and the engine does not, carried into the one audit row.
export interface SyncMeta { locations: number; warnings: number }

/**
 * One sync of an event's roster against WellnessLiving. `records` null means run against
 * the pool already cached, which is what the rematch route does; anything else replaces
 * the pool first.
 *
 * Only an exact name links by itself. A near match is written onto the row as a
 * suggestion for a person to confirm, and a candidate a person has refused is never
 * offered again. Runs inside the transaction the caller opened.
 */
export async function syncRoster(
  db: DbLike,
  eventId: number,
  records: WlBeltRecord[] | null,
  competitors: LeaderboardCompetitor[],
  meta: SyncMeta = { locations: 0, warnings: 0 },
): Promise<SyncReport> {
  if (records !== null) {
    const built = buildCandidates(records, competitors)
    await db.delete(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).run()
    if (built.length > 0) await db.insert(rosterCandidates).values(built.map(cand => ({ eventId, ...cand }))).run()
  }
  const pool = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).all()
  const roster = await db.select().from(athletes).where(eq(athletes.eventId, eventId))
    .orderBy(asc(athletes.lastName), asc(athletes.firstName)).all()

  const poolByUid = new Map(pool.map(cand => [cand.wlUid, cand]))
  const claimed = new Set(roster.filter(a => a.wlUid !== null).map(a => a.wlUid as string))

  const linked: string[] = []
  const changed: string[] = []
  const suggested: SyncSuggestion[] = []
  const ambiguous: string[] = []
  const unmatched: string[] = []
  const gone: string[] = []
  let refreshed = 0
  let wrote = 0

  const at = new Date().toISOString()
  const write = async (id: number, update: AthleteUpdate) => {
    await db.update(athletes).set({ ...update, syncedAt: at }).where(eq(athletes.id, id)).run()
    wrote += 1
  }

  for (const athlete of roster) {
    const name = fullName(athlete)

    if (athlete.wlUid !== null) {
      const cand = poolByUid.get(athlete.wlUid)
      // The link stands. A child WellnessLiving no longer returns is far more often a
      // narrowed location pick than a child who left, and dropping the profile would
      // lose a belt the desk still needs this afternoon.
      if (!cand) {
        gone.push(name)
        await write(athlete.id, { syncChanges: { pool: { from: 'present', to: 'missing' } } })
        continue
      }
      const update = linkUpdate(athlete, cand)
      const diff = profileChanges(athlete, update)
      await write(athlete.id, { ...update, syncChanges: diff })
      refreshed += 1
      if (Object.keys(diff).length > 0) changed.push(name)
      continue
    }

    const exact = pool.filter(cand => !claimed.has(cand.wlUid) && exactName(athlete, cand))
    if (exact.length === 1) {
      const cand = exact[0]
      const update = linkUpdate(athlete, cand)
      await write(athlete.id, { ...update, syncChanges: profileChanges(athlete, update), suggestedWlUid: null, suggestedScore: null })
      claimed.add(cand.wlUid)
      linked.push(name)
      continue
    }
    if (exact.length >= 2) {
      ambiguous.push(name)
      continue
    }

    const dismissed = new Set(athlete.dismissedWlUids)
    const scored = pool
      .filter(cand => !claimed.has(cand.wlUid) && !dismissed.has(cand.wlUid))
      .map(cand => ({ cand, score: nameScore(athlete, cand) }))
      .sort((x, y) => y.score - x.score)
    const [best, next] = scored
    const clear = best === undefined || best.score < SUGGEST_FLOOR || (next !== undefined && best.score - next.score < SUGGEST_MARGIN)

    if (clear) {
      unmatched.push(name)
      if (athlete.suggestedWlUid !== null) await write(athlete.id, { suggestedWlUid: null, suggestedScore: null })
      continue
    }
    suggested.push({ athleteId: athlete.id, name, candidate: fullName(best.cand), location: best.cand.wlLocation ?? '', score: best.score })
    if (athlete.suggestedWlUid !== best.cand.wlUid || athlete.suggestedScore !== best.score) {
      await write(athlete.id, { suggestedWlUid: best.cand.wlUid, suggestedScore: best.score })
    }
  }

  // A pull replaced the pool, which is a write whether or not it moved an athlete, so the
  // history always carries the sync that ran. A rematch against the cached pool that
  // changed nothing did nothing worth recording.
  if (records !== null || wrote > 0) {
    await recordAudit(db, {
      eventId, actor: 'admin', action: 'roster_sync',
      detail: {
        locations: meta.locations, candidates: pool.length, warnings: meta.warnings,
        linked: linked.length, refreshed, changed: changed.length,
        suggested: suggested.length, ambiguous: ambiguous.length, unmatched: unmatched.length, gone: gone.length,
        names: { suggested: suggested.map(s => s.name), ambiguous, unmatched, gone },
      },
    })
  }
  // Only an athlete row reaches a screen that polls. Replacing the pool does not.
  if (wrote > 0) await bumpVersion(db, eventId)

  return { linked, refreshed, changed, suggested, ambiguous, unmatched, gone }
}
