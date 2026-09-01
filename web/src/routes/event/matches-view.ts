import type { ClockState, MatchStatus, Snapshot } from '@shared/types'
import type { EventDetail, MatchRow } from '@/lib/types'

export type MatchLane = 'live' | 'pending' | 'settled'
// 7.4: one closed vocabulary as one attribute, so every colour, weight and
// affordance is keyed on the state rather than re-decided at each call site.
export type MatchState = 'pending' | 'ready' | 'live' | 'done' | 'skipped'

export interface MatchLine {
  row: MatchRow
  status: MatchStatus
  state: MatchState
  lane: MatchLane
  /** 1-based place in the whole running order, so a number means the same thing in every field. */
  position: number
  matNumber: number | null
  clock: ClockState | null
  endedAt: string | null
}

const byOrder = (x: MatchRow, y: MatchRow) => x.orderIndex - y.orderIndex || x.id - y.id

/**
 * One row list from two sources, and which source owns which field is the whole point.
 *
 * The event detail owns what the operator is editing: which matches exist, who is in
 * them, their mat, ruleset, length and order. Those refetch from the operator's own
 * writes, so a poll can never move them under a hand (4.4).
 *
 * The snapshot owns what the event is doing: status, the clock, and which pending match
 * a mat will call next. That is the freshest account of the room, and it is the reason
 * this screen is driven by the shared snapshot at all.
 */
export function matchLines(detail: EventDetail, snapshot: Snapshot | null): MatchLine[] {
  const views = new Map((snapshot?.matches ?? []).map(m => [m.id, m]))
  const matNumbers = new Map(detail.mats.map(m => [m.id, m.number]))
  const ready = new Set((snapshot?.mats ?? []).flatMap(m => (m.onDeck.length > 0 ? [m.onDeck[0].id] : [])))

  return [...detail.matches].sort(byOrder).map((row, i) => {
    const view = views.get(row.id)
    const status = view?.status ?? row.status
    // A skip is filed as an admin event and hands the match back to the pending queue at
    // the end of its mat's order, so the sequence counter is the only trace of it that
    // reaches this client. A pending match nobody has touched still reads zero.
    const skipped = status === 'pending' && (view?.lastSeq ?? row.lastSeq) > 0
    const state: MatchState = status === 'live' ? 'live'
      : status === 'done' ? 'done'
        : skipped ? 'skipped'
          : ready.has(row.id) ? 'ready'
            : 'pending'
    return {
      row,
      status,
      state,
      lane: status === 'live' ? 'live' : status === 'done' ? 'settled' : 'pending',
      position: i + 1,
      matNumber: row.matId === null ? null : matNumbers.get(row.matId) ?? null,
      clock: view?.clock ?? null,
      endedAt: view?.endedAt ?? row.endedAt ?? null,
    }
  })
}

// 6.8 prints the refusal rather than opening a dialog that says no, so every refused
// control needs the same sentence the row is already showing.
export function liveReason(line: MatchLine): string {
  return line.matNumber === null ? 'Live, no mat' : `Live on mat ${line.matNumber}`
}

export function skipNote(line: MatchLine): string {
  const where = line.matNumber === null ? 'the queue' : `mat ${line.matNumber}`
  return `Skipped, moved to the end of ${where}`
}

export function readyNote(line: MatchLine): string | null {
  return line.matNumber === null ? null : `Next on mat ${line.matNumber}`
}

export function regenerateBlockedReason(live: MatchLine[]): string | null {
  if (live.length === 0) return null
  const mats = live.map(l => l.matNumber).filter((n): n is number => n !== null).sort((a, b) => a - b)
  if (mats.length === 0) return 'A match is live'
  if (mats.length === 1) return `Live on mat ${mats[0]}`
  return `Live on mats ${mats.slice(0, -1).join(', ')} and ${mats[mats.length - 1]}`
}

/**
 * Regenerate deletes every pending row, hand ordering included, so the dialog states the
 * figure it is about to discard. The hand-ordered count is what this browser has moved:
 * the server stores an order, not who chose it, so a reload honestly reports none.
 */
export function regenerateWarning(pendingCount: number, handOrderedCount: number): string {
  const replaced = `${pendingCount} pending ${pendingCount === 1 ? 'match' : 'matches'} will be replaced.`
  return handOrderedCount === 0 ? replaced : `${replaced} ${handOrderedCount} of them you reordered by hand.`
}

export function endedLabel(endedAt: string | null): string {
  if (!endedAt) return ''
  const at = new Date(endedAt)
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getHours() % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')}`
}
