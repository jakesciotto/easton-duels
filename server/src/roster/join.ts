import type { WlBeltRecord, LeaderboardCompetitor, RosterCandidate } from './types.js'
import { deriveKidsBelt } from './belts.js'
import { ageFromAgeGroup, weightFromWeightClass } from './parse.js'
import { makeCompetitorId } from './slug.js'

export function buildCandidates(records: WlBeltRecord[], competitors: LeaderboardCompetitor[]): RosterCandidate[] {
  const latest = new Map<string, WlBeltRecord>()
  for (const r of records) {
    const prev = latest.get(r.uid)
    if (!prev || String(r.promotedAt ?? '') > String(prev.promotedAt ?? '')) latest.set(r.uid, r)
  }
  const bySlug = new Map(competitors.map(c => [c.id, c]))
  return [...latest.values()]
    .map(r => {
      const c = bySlug.get(makeCompetitorId(`${r.firstName} ${r.lastName}`)) ?? null
      return {
        wlUid: r.uid,
        firstName: r.firstName,
        lastName: r.lastName,
        belt: deriveKidsBelt(r.rankTitle),
        wlLocation: r.location,
        leaderboardId: c?.id ?? null,
        erp: c?.erp ?? null,
        age: ageFromAgeGroup(c?.ageGroup ?? null),
        weightLbs: weightFromWeightClass(c?.weightClass ?? null),
        gender: c?.gender ?? null,
      }
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
}
