import type { MatchRow } from './types'

// The server allows a competitor to sit in two pending matches at once (uneven rosters
// make it a legitimate organizer choice); the designer only warns.
export function isDoubleBooked(athleteId: number, matches: MatchRow[], excludeMatchId?: number): boolean {
  return matches.some(m => m.status === 'pending' && m.id !== excludeMatchId && (m.athleteAId === athleteId || m.athleteBId === athleteId))
}

export function doubleBookedMatchIds(matches: MatchRow[]): Set<number> {
  const pending = matches.filter(m => m.status === 'pending')
  const counts = new Map<number, number>()
  const bump = (id: number) => counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const m of pending) {
    bump(m.athleteAId)
    bump(m.athleteBId)
  }
  const ids = new Set<number>()
  for (const m of pending) {
    if ((counts.get(m.athleteAId) ?? 0) > 1 || (counts.get(m.athleteBId) ?? 0) > 1) ids.add(m.id)
  }
  return ids
}
