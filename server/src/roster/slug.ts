// Copied from easton-leaderboard lib/data/transform.js makeCompetitorId. Do not change: the join depends on byte equality.
export function makeCompetitorId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
