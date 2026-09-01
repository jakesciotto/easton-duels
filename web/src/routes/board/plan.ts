import type { MatchView, Snapshot } from '@shared/types'

export type Composition = 'cold' | 'mats' | 'entry' | 'done'

export interface BoardPlan {
  comp: Composition
  /** 1 to 4. Chooses the mat band's row count and therefore its geometry. */
  mats: number
}

// Newest finish first. A match without an endedAt (finished before the field existed)
// sorts after every match that has one, tie broken by id descending either way.
export function sortDoneMatches(matches: MatchView[]): MatchView[] {
  return [...matches].sort((x, y) => {
    if (x.endedAt === null && y.endedAt === null) return y.id - x.id
    if (x.endedAt === null) return 1
    if (y.endedAt === null) return -1
    if (x.endedAt !== y.endedAt) return x.endedAt < y.endedAt ? 1 : -1
    return y.id - x.id
  })
}

/**
 * Six compositions, not one grid with holes. Every budget in board.css sums to the
 * safe area's 90cqh, so the composition has to be chosen before anything is measured.
 */
export function boardPlan(snapshot: Snapshot | null, held: ReadonlyMap<number, MatchView>): BoardPlan {
  if (!snapshot || snapshot.teams.length < 2) return { comp: 'cold', mats: 1 }
  if (snapshot.event.status === 'done') return { comp: 'done', mats: 1 }

  const active = snapshot.mats.some(m => m.current !== null || held.has(m.id))
  const results = snapshot.matches.some(m => m.status === 'done')
  // No mat is carrying a match and results exist, so somebody is typing them at a
  // desk. That is a final score panel, not a degraded live board.
  if (!active && results) return { comp: 'entry', mats: 1 }

  return { comp: 'mats', mats: Math.min(4, Math.max(1, snapshot.mats.length)) }
}
