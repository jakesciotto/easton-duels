import type { CSSProperties } from 'react'
import type { MatchView, Snapshot } from '@shared/types'
import { ageSeconds, formatAge, isStale } from '@/lib/freshness'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import { useNow } from '@/lib/useClock'
import { Hero, HeroSkeleton } from './Hero'
import { MatBand } from './MatBand'
import { ResultsBand } from './ResultsBand'
import { SetupBand } from './SetupBand'
import { DoneBand, winningTeam } from './DoneBand'
import { boardPlan, sortDoneMatches } from './plan'
import { useFar } from './useFar'
import { useHeldResults } from './useHeldResults'
import { useSettleTimer } from './useSettleTimer'
import './board.css'

const ENTRY_ROWS = 4
// The note prints whole seconds, so it needs no finer tick than the unit it reports.
const AGE_TICK_MS = 1000

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

export function Board({ snapshot, connected, lastSuccessAt = null, screenMaySleep = false }: {
  snapshot: Snapshot | null
  connected: boolean
  /** 7.6: the last poll that actually reached the server. Null until the first one does,
      which is a loading state rather than a stale one. */
  lastSuccessAt?: number | null
  screenMaySleep?: boolean
}) {
  const far = useFar()
  const held = useHeldResults(snapshot)
  const plan = boardPlan(snapshot, held)
  const pollIntervalMs = pollIntervalForSnapshot(snapshot)

  const now = useNow(lastSuccessAt !== null, AGE_TICK_MS)
  const stale = isStale(lastSuccessAt, now, pollIntervalMs)
  const ageSec = ageSeconds(lastSuccessAt, now)

  const done = snapshot ? sortDoneMatches(snapshot.matches.filter(m => m.status === 'done')) : []
  const entryRows = plan.comp === 'entry' ? done.slice(0, ENTRY_ROWS) : []
  const settled = useSettleTimer(settleIds(snapshot, held, entryRows), snapshot !== null)

  const winner = snapshot && plan.comp === 'done' ? winningTeam(snapshot.teams) : null

  // 4.3: an attention state is never carried by colour alone, and a 1.2cqh bar at the
  // edge of the stage is not a message. Both of these say what is wrong, in words, at
  // b3, inside the safe area where the room reads.
  const notes = [
    stale && ageSec !== null ? `Not updating ${formatAge(ageSec)}` : null,
    screenMaySleep ? 'Screen may sleep' : null,
  ].filter((note): note is string => note !== null)

  return (
    <main className="b-frame">
      <div className="b-stage" style={{ '--far': String(far) } as CSSProperties}>
        <div
          className="b-safe"
          data-comp={plan.comp}
          data-mats={plan.mats}
          style={{ '--mats': String(plan.mats) } as CSSProperties}
        >
          {snapshot === null || plan.comp === 'cold'
            ? <HeroSkeleton />
            : <Hero teams={snapshot.teams} winnerId={plan.comp === 'done' ? winner?.id ?? null : null} />}

          {snapshot !== null && plan.comp === 'setup' && <SetupBand mats={snapshot.mats} />}
          {snapshot !== null && plan.comp === 'mats' && (
            <MatBand
              mats={snapshot.mats}
              held={held}
              settled={settled}
              serverNow={snapshot.now}
              lastSuccessAt={lastSuccessAt}
              pollIntervalMs={pollIntervalMs}
            />
          )}
          {snapshot !== null && plan.comp === 'entry' && (
            <ResultsBand results={entryRows} total={done.length} settled={settled} />
          )}
          {snapshot !== null && plan.comp === 'done' && (
            <DoneBand teams={snapshot.teams} matches={done.length} />
          )}
          {snapshot === null && <div className="b-band" />}

          {notes.length > 0 && (
            <div role="status" className="b-note font-sans">
              {notes.map(note => <span key={note}>{note}</span>)}
            </div>
          )}
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
