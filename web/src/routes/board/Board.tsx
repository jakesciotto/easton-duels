import type { CSSProperties } from 'react'
import type { MatchView, Snapshot } from '@shared/types'
import { Hero, HeroSkeleton } from './Hero'
import { MatBand } from './MatBand'
import { ResultsBand } from './ResultsBand'
import { DoneBand, winningTeam } from './DoneBand'
import { boardPlan, sortDoneMatches } from './plan'
import { useFar } from './useFar'
import { useHeldResults } from './useHeldResults'
import { useSettleTimer } from './useSettleTimer'
import './board.css'

const ENTRY_ROWS = 4

function settleIds(snapshot: Snapshot | null, held: ReadonlyMap<number, MatchView>, entry: MatchView[]): number[] {
  if (!snapshot) return []
  const ids = new Set<number>()
  for (const mat of snapshot.mats) {
    const showing = mat.current ?? held.get(mat.id) ?? null
    if (showing && showing.status === 'done') ids.add(showing.id)
  }
  for (const match of entry) ids.add(match.id)
  return [...ids].sort((x, y) => x - y)
}

export function Board({ snapshot, connected }: { snapshot: Snapshot | null; connected: boolean }) {
  const far = useFar()
  const held = useHeldResults(snapshot)
  const plan = boardPlan(snapshot, held)

  const done = snapshot ? sortDoneMatches(snapshot.matches.filter(m => m.status === 'done')) : []
  const entryRows = plan.comp === 'entry' ? done.slice(0, ENTRY_ROWS) : []
  const settled = useSettleTimer(settleIds(snapshot, held, entryRows), snapshot !== null)

  const winner = snapshot && plan.comp === 'done' ? winningTeam(snapshot.teams) : null

  return (
    <main className="b-frame">
      <div className="b-stage" style={{ '--far': String(far) } as CSSProperties}>
        <div className="b-safe" data-comp={plan.comp} data-mats={plan.mats}>
          {snapshot === null || plan.comp === 'cold'
            ? <HeroSkeleton />
            : <Hero teams={snapshot.teams} winnerId={plan.comp === 'done' ? winner?.id ?? null : null} />}

          {snapshot !== null && plan.comp === 'mats' && (
            <MatBand mats={snapshot.mats} held={held} settled={settled} serverNow={snapshot.now} />
          )}
          {snapshot !== null && plan.comp === 'entry' && (
            <ResultsBand results={entryRows} total={done.length} settled={settled} />
          )}
          {snapshot !== null && plan.comp === 'done' && (
            <DoneBand teams={snapshot.teams} matches={done.length} />
          )}
          {snapshot === null && <div className="b-band" />}
        </div>
        {!connected && (
          <div role="status" className="b-stale">
            <span className="sr-only">Reconnecting to the server</span>
          </div>
        )}
      </div>
    </main>
  )
}
