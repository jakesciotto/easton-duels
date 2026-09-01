import type { MatchView, Snapshot } from '@shared/types'

export type Composition = 'cold' | 'setup' | 'mats' | 'entry' | 'done'

export interface BoardPlan {
  comp: Composition
  /** The event's actual mat count, at least 1. The mat band derives its panel height
      from this rather than from a clamp, because the API accepts up to eight mats and a
      clamp meant every mat above the fourth was laid out off the bottom of the band. */
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

  const mats = Math.max(1, snapshot.mats.length)
  const results = snapshot.matches.some(m => m.status === 'done')
  // Whether a mat is bound is an event-wide setting that survives a reload. Whether one
  // happens to be carrying a match this second is not, and the held results are derived
  // from transitions this client watched, so both are empty on the first snapshot after
  // any reload. Gating on those alone repainted the whole board as a Final Score panel
  // every time four bouts ended together, and relaid it out again the moment mat 1
  // started.
  const matsInUse = snapshot.mats.some(m => m.bound || m.current !== null || held.has(m.id))

  // Before the first whistle nobody is asking about a score, and the queue fits.
  if (snapshot.event.status === 'setup' && !results) return { comp: 'setup', mats }
  if (matsInUse) return { comp: 'mats', mats }
  // No mat is bound, carrying or holding a match and results exist, so somebody is
  // typing them at a desk. That is a final score panel, not a degraded live board.
  if (results) return { comp: 'entry', mats: 1 }

  return { comp: 'mats', mats }
}
