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
 *
 * How the event is run is a stored fact about the EVENT, not something read off
 * whichever mat happens to be bound this second. `entry` means the desk types every
 * result and the room reads a Final Score panel; `live` means the mats drive the event
 * and the room reads the mat ledger. The board never chooses between them.
 *
 * There is no inference left to fall back to. The column is NOT NULL with a default of
 * `live`, and the bundle and the snapshot come off one deploy, so a snapshot without the
 * field is not a state this code can reach; a missing mode is read as `live`, which is
 * the only value an event that predates the column can hold. The inference that used to
 * sit here is the code whose own bug motivated the column: held results are derived from
 * transitions this client watched and a binding is dropped between bouts, so on the first
 * snapshot after a reload it read the board as a desk and repainted the whole stage as a
 * Final Score panel until a mat started again.
 */
export function boardPlan(snapshot: Snapshot | null): BoardPlan {
  if (!snapshot || snapshot.teams.length < 2) return { comp: 'cold', mats: 1 }
  if (snapshot.event.status === 'done') return { comp: 'done', mats: 1 }

  const mats = Math.max(1, snapshot.mats.length)
  const results = snapshot.matches.some(m => m.status === 'done')

  // Before the first whistle nobody is asking about a score, and the queue fits. Both
  // modes open here.
  if (snapshot.event.status === 'setup' && !results) return { comp: 'setup', mats }

  return snapshot.event.mode === 'entry' ? { comp: 'entry', mats: 1 } : { comp: 'mats', mats }
}
