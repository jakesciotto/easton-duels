import type { MatchView, Snapshot } from '@shared/types'
import { athleteName } from './format'
import type { EventDetail, MatchRow } from './types'

/**
 * The one dialog that corrects a result takes a MatchView, and two of the three screens
 * that reach it hold MatchRows, because the event detail is what the operator edits and
 * the snapshot is what the event is doing.
 *
 * The snapshot's own row is preferred wherever there is one: it carries the live score
 * and the server's endedAt. The row is the fallback for the moments before the first
 * snapshot lands, so the control never has to be disabled on a screen that already has
 * everything it needs to state what is being corrected.
 */
export function matchViewOf(row: MatchRow, detail: EventDetail, snapshot: Snapshot | null): MatchView {
  const live = snapshot?.matches.find(m => m.id === row.id)
  if (live) return live
  const side = (athleteId: number, score: number) => {
    const kid = detail.athletes.find(a => a.id === athleteId)
    return {
      athleteId,
      name: kid ? athleteName(kid) : 'Unknown',
      teamId: kid?.teamId ?? null,
      belt: kid?.belt ?? null,
      weightLbs: kid?.weightLbs ?? null,
      score,
    }
  }
  return {
    id: row.id,
    orderIndex: row.orderIndex,
    matId: row.matId,
    status: row.status,
    rulesetId: row.rulesetId,
    lengthSec: row.lengthSec,
    why: row.why,
    a: side(row.athleteAId, row.pointsA),
    b: side(row.athleteBId, row.pointsB),
    clock: { elapsedMs: row.clockElapsedMs, startedAt: row.clockStartedAt, lengthMs: row.lengthSec * 1000 },
    result: row.winnerAthleteId === null || row.winType === null
      ? null
      : { winnerAthleteId: row.winnerAthleteId, winType: row.winType },
    pendingTerminal: null,
    endedAt: row.endedAt ?? null,
    lastSeq: row.lastSeq,
  }
}
