import { athletes, rosterCandidates, type AthleteRow } from '../db/schema.js'

type CandidateRow = typeof rosterCandidates.$inferSelect
type AthleteUpdate = Partial<typeof athletes.$inferInsert>

// The fields linkUpdate reads off a candidate, without id or eventId. A drizzle row
// fits it directly; upsertCandidates' plain RosterCandidate fits it too, because its
// wlLocation is a non-null string, narrower than the column's nullable type here.
type CandidateFields = Pick<CandidateRow, 'wlUid' | 'wlLocation' | 'leaderboardId' | 'erp' | 'belt' | 'gender' | 'age' | 'weightLbs' | 'promotedAt'>

export function fullName(a: { firstName: string; lastName: string }): string {
  return `${a.firstName} ${a.lastName}`
}

/**
 * The fields one candidate writes onto one athlete. `force` is the first link: the
 * paste's age and weight give way. After that a hand typed value keeps.
 *
 * The promotion date belongs to the belt, so it travels with it and only with it. A
 * candidate carrying no belt leaves both alone rather than dating a belt it did not set.
 */
export function linkUpdate(existing: Pick<AthleteRow, 'wlUid' | 'ageSource' | 'weightSource'>, cand: CandidateFields): AthleteUpdate {
  const force = existing.wlUid === null
  const update: AthleteUpdate = {
    wlUid: cand.wlUid,
    wlLocation: cand.wlLocation,
    leaderboardId: cand.leaderboardId,
    erp: cand.erp,
  }
  if (cand.belt !== null) {
    update.belt = cand.belt
    update.promotedAt = cand.promotedAt
  }
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
