import { eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { athletes, rosterCandidates, type AthleteRow } from '../db/schema.js'
import { makeCompetitorId } from './slug.js'
import { recordAudit } from '../audit/log.js'
import { bumpVersion } from '../match/events.js'
import type { MatchReport } from '../shared/types.js'

type CandidateRow = typeof rosterCandidates.$inferSelect
type AthleteUpdate = Partial<typeof athletes.$inferInsert>

// The fields linkUpdate reads off a candidate, without id or eventId. A drizzle row
// fits it directly; upsertCandidates' plain RosterCandidate fits it too, because its
// wlLocation is a non-null string, narrower than the column's nullable type here.
type CandidateFields = Pick<CandidateRow, 'wlUid' | 'wlLocation' | 'leaderboardId' | 'erp' | 'belt' | 'gender' | 'age' | 'weightLbs'>

export function fullName(a: { firstName: string; lastName: string }): string {
  return `${a.firstName} ${a.lastName}`
}

/**
 * The fields one candidate writes onto one athlete. `force` is the first link: the
 * paste's age and weight give way. After that a hand typed value keeps.
 */
export function linkUpdate(existing: Pick<AthleteRow, 'wlUid' | 'ageSource' | 'weightSource'>, cand: CandidateFields): AthleteUpdate {
  const force = existing.wlUid === null
  const update: AthleteUpdate = {
    wlUid: cand.wlUid,
    wlLocation: cand.wlLocation,
    leaderboardId: cand.leaderboardId,
    erp: cand.erp,
  }
  if (cand.belt !== null) update.belt = cand.belt
  if (cand.gender !== null) update.gender = cand.gender
  if (cand.age !== null && (force || existing.ageSource !== 'manual')) {
    update.age = cand.age
    update.ageSource = 'leaderboard'
  }
  if (cand.weightLbs !== null && (force || existing.weightSource !== 'manual')) {
    update.weightLbs = cand.weightLbs
    update.weightSource = 'leaderboard'
  }
  return update
}

function bySlug(rows: CandidateRow[]): Map<string, CandidateRow[]> {
  const map = new Map<string, CandidateRow[]>()
  for (const row of rows) {
    const slug = makeCompetitorId(fullName(row))
    const list = map.get(slug)
    if (list) list.push(row)
    else map.set(slug, [row])
  }
  return map
}

/**
 * Links the pool to the event's roster. Every unlinked athlete whose name slug matches
 * exactly one available candidate is linked; a name with no candidate is unmatched, a
 * name with two or more available candidates is ambiguous, and a name whose only
 * candidate is already claimed by another athlete of this event is a duplicate. Every
 * already linked athlete is refreshed from the candidate with its wlUid, with `force`
 * false so a hand typed age or weight stays. Runs inside the transaction the caller
 * opened.
 */
export async function matchRoster(db: DbLike, eventId: number): Promise<MatchReport> {
  const pool = await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).all()
  const roster = await db.select().from(athletes).where(eq(athletes.eventId, eventId)).all()

  const poolBySlug = bySlug(pool)
  const poolByWlUid = new Map(pool.map(c => [c.wlUid, c]))
  const claimed = new Set(roster.filter(a => a.wlUid !== null).map(a => a.wlUid as string))

  const matched: string[] = []
  const unmatched: string[] = []
  const ambiguous: string[] = []
  const duplicates: string[] = []
  let refreshed = 0

  for (const athlete of roster) {
    if (athlete.wlUid !== null) continue
    const name = fullName(athlete)
    const raw = poolBySlug.get(makeCompetitorId(name)) ?? []
    const available = raw.filter(c => !claimed.has(c.wlUid))
    if (available.length === 1) {
      const cand = available[0]
      await db.update(athletes).set(linkUpdate(athlete, cand)).where(eq(athletes.id, athlete.id)).run()
      claimed.add(cand.wlUid)
      matched.push(name)
    } else if (available.length >= 2) {
      ambiguous.push(name)
    } else if (raw.length > 0) {
      duplicates.push(name)
    } else {
      unmatched.push(name)
    }
  }

  for (const athlete of roster) {
    if (athlete.wlUid === null) continue
    const cand = poolByWlUid.get(athlete.wlUid)
    if (!cand) continue
    await db.update(athletes).set(linkUpdate(athlete, cand)).where(eq(athletes.id, athlete.id)).run()
    refreshed += 1
  }

  if (matched.length > 0 || refreshed > 0) {
    await recordAudit(db, {
      eventId, actor: 'admin', action: 'roster_link',
      detail: { kind: 'match', matched: matched.length, refreshed, unmatched, ambiguous, duplicates },
    })
    await bumpVersion(db, eventId)
  }
  return { matched, refreshed, unmatched, ambiguous, duplicates }
}
