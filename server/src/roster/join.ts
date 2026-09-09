import type { WlBeltRecord, LeaderboardCompetitor, RosterCandidate } from './types.js'
import { deriveKidsBelt } from './belts.js'
import { ageFromAgeGroup, weightFromWeightClass } from './parse.js'
import { makeCompetitorId } from './slug.js'

// WellnessLiving reports the promotion as a datetime, "2024-05-14 06:00:00". The profile
// prints the day, so the pool keeps the day.
function promotionDate(raw: string | null): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw ?? '')
  return m ? m[1] : raw || null
}

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
        promotedAt: promotionDate(r.promotedAt),
      }
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
}
