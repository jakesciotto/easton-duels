import { asc, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { athletes, rosterCandidates, type AthleteRow } from '../db/schema.js'
import { buildCandidates } from './join.js'
import { fullName, linkUpdate } from './link.js'
import { exactName, nameScore, nameTokens, SUGGEST_FLOOR, SUGGEST_MARGIN } from '../shared/similarity.js'
import { recordAudit } from '../audit/log.js'
import { bumpVersion } from '../match/events.js'
import type { LeaderboardCompetitor, WlBeltRecord, WlNameFilter } from './types.js'
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
 * Who a sync asks WellnessLiving about: the uid of every row already linked, and the
 * tokens of every row's last name, linked ones too, so a child whose uid has gone can
 * surface as a near match again. A first name would only widen what the last name already
 * asks for. A row whose last name yields no token is a row the sync cannot ask about.
 */
export function rosterFilter(rows: { wlUid: string | null; lastName: string }[]): WlNameFilter {
  const uids = new Set<string>()
  const lastTokens = new Set<string>()
  for (const row of rows) {
    if (row.wlUid !== null) uids.add(row.wlUid)
    for (const token of nameTokens(row.lastName)) lastTokens.add(token)
  }
  return { uids: [...uids], lastTokens: [...lastTokens], firstTokens: [] }
}

/**
 * One sync of an event's roster against WellnessLiving. `records` null means run against
 * the pool already cached, which is what the rematch route does; anything else replaces
 * the pool first.
 *
 * Only an exact name links by itself. A near match is written onto the row as a
 * suggestion for a person to confirm, and a candidate a person has refused is never
 * offered again. Runs inside the transaction the caller opened.
 */
export const POOL_INSERT_ROWS = 500

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

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
    // SQLite binds at most 32766 variables in one statement, and eight locations give
    // more than four thousand candidates at thirteen columns each. Rows go in slices
    // that stay well under the limit.
    for (const slice of chunks(built.map(cand => ({ eventId, ...cand })), POOL_INSERT_ROWS)) {
      await db.insert(rosterCandidates).values(slice).run()
    }
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

  // A pull asked WellnessLiving for this roster by name, so every row it considered
  // carries the time it looked, unmatched rows too, and the web can say "Not in
  // WellnessLiving" only about a row a sync has been through. A rematch against the
  // cached pool asked nobody, and leaves an untouched row alone.
  const looked = records !== null

  const at = new Date().toISOString()
  // syncedAt is the time the sync looked at that row, so only a row it could ask
  // WellnessLiving about earns one. Every write still counts towards the version.
  const write = async (id: number, update: AthleteUpdate, { stamp = true } = {}) => {
    await db.update(athletes).set(stamp ? { ...update, syncedAt: at } : update).where(eq(athletes.id, id)).run()
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
      // An unlinked row is asked about by the tokens of its last name alone, so a name
      // that yields none is a name the pull never carried to WellnessLiving.
      const asked = looked && nameTokens(athlete.lastName).length > 0
      const update: AthleteUpdate = asked ? { syncChanges: {} } : {}
      // A suggestion the pool no longer holds goes whether or not the sync asked about the
      // row, because the candidate behind it is gone. Clearing it is not evidence that
      // anybody looked, so it carries no stamp of its own.
      if (athlete.suggestedWlUid !== null) {
        update.suggestedWlUid = null
        update.suggestedScore = null
      }
      if (Object.keys(update).length > 0) await write(athlete.id, update, { stamp: asked })
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
