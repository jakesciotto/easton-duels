import { useRef, type CSSProperties } from 'react'
import type { MatchView, Snapshot } from '@shared/types'
import { ageSeconds, formatAge, isStale } from '@/lib/freshness'
import { timeOfDay } from '@/lib/format'
import { POLL_CLOCK_RUNNING_MS, POLL_DEADLINE_MIN_MS, pollIntervalForSnapshot } from '@/lib/pollInterval'
import { useNow } from '@/lib/useClock'
import { Hero, HeroSkeleton } from './Hero'
import { MatBand } from './MatBand'
import { ResultsBand } from './ResultsBand'
import { OrderBand, SetupBand } from './SetupBand'
import { DoneBand } from './DoneBand'
import { boardPlan } from './plan'
import { sortDoneMatches } from '@/lib/matchOrder'
import { budgetWithNotes } from './budget'
import { useFar } from './useFar'
import { useHeldResults } from './useHeldResults'
import { useSettleTimer } from './useSettleTimer'
import './board.css'

// The note prints whole seconds, so it needs no finer tick than the unit it reports.
const AGE_TICK_MS = 1000

/**
 * How long a board that has never heard from the server stays silent.
 *
 * The first poll is a normal state and it can be in flight for its whole deadline, so
 * saying anything sooner would print a fault on every healthy start and then take the
 * line back, which relays out the composition in front of the room. The note waits for a
 * genuine second attempt, and the arithmetic is the poll loop's own:
 *
 *   attempt 1 aborts at max(POLL_DEADLINE_MIN_MS, interval x 3)      4000ms
 *     nothing has landed, so the interval is POLL_CLOCK_RUNNING_MS
 *     and 3 x 1000 does not reach the 4000 floor
 *   the next tick is scheduled one interval after that abort        + 1000ms
 *   attempt 2 aborts at its own deadline                            + 4000ms
 *                                                                   = 9000ms
 *
 * The old constant was one deadline plus one interval, which is the instant attempt two
 * is dispatched rather than the instant it settles: on a congested network the board told
 * the room it could not reach the server while its second request was still in flight.
 */
export const FIRST_CONTACT_MS = POLL_DEADLINE_MIN_MS * 2 + POLL_CLOCK_RUNNING_MS

/**
 * The board is the one polled surface nobody in the room can query. Every other note it
 * carries is derived from `lastSuccessAt`, so a board opened on the wrong network, or
 * before the laptop is up, or on an event id that answers 404, has no note at all: it
 * holds the cold start skeleton for the rest of the afternoon and somebody has to guess.
 */
export const NOTE_NO_CONTACT = 'Cannot reach the server'

/** 6.15's certified line, with the time of the signature after it. */
export const CERTIFIED_NOTE = 'Final, certified at'

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
  const far = useFar(snapshot)
  const held = useHeldResults(snapshot)
  const plan = boardPlan(snapshot)
  const pollIntervalMs = pollIntervalForSnapshot(snapshot)

  // Nothing has ever arrived and the poll is not landing. Both halves matter: without
  // the second this is the ordinary first moment of every board.
  const silent = lastSuccessAt === null && !connected
  const openedAt = useRef(Date.now())
  const now = useNow(lastSuccessAt !== null || silent, AGE_TICK_MS)
  const stale = isStale(lastSuccessAt, now, pollIntervalMs)
  const ageSec = ageSeconds(lastSuccessAt, now)
  const unreachable = silent && now - openedAt.current >= FIRST_CONTACT_MS

  // The signature on the record, under the summary and centred, in its own b3 line.
  // It is not a note: section 8 reserves the note's attend colour for a state that needs
  // a person, and this one needs nobody. Absent before certification: the board never
  // says Final, uncertified.
  const certifiedAt = plan.comp === 'done' ? timeOfDay(snapshot?.event.certifiedAt) : null

  // 4.3: an attention state is never carried by colour alone, and a 1.2cqh bar at the
  // edge of the stage is not a message. Each of these says what is wrong, in words, at
  // b3, inside the safe area where the room reads.
  const reported = [
    unreachable ? NOTE_NO_CONTACT : null,
    stale && ageSec !== null ? `Not updating ${formatAge(ageSec)}` : null,
    screenMaySleep ? 'Screen may sleep' : null,
  ].filter((note): note is string => note !== null)

  // The note and the certified line each take a b3 line out of the composition rather
  // than painting over one, so the budget has to be resolved together with them.
  const { budget, notes } = budgetWithNotes(
    { comp: plan.comp, mats: plan.mats, teams: plan.teams, far, sign: certifiedAt !== null },
    reported,
  )

  const done = snapshot ? sortDoneMatches(snapshot.matches.filter(m => m.status === 'done')) : []
  const entryRows = plan.comp === 'entry' ? done.slice(0, budget.rows) : []
  const settled = useSettleTimer(settleIds(snapshot, held, entryRows), snapshot !== null)

  // 7.3's team edge is read off the snapshot's own teams, so a row can only ever paint a
  // colour the board is already showing in the hero.
  const teamColors = new Map((snapshot?.teams ?? []).map(t => [t.id, t.color]))
  const teamColor = (teamId: number | null) => (teamId === null ? null : teamColors.get(teamId) ?? null)

  return (
    <main className="b-frame">
      <div className="b-stage" style={{ '--far': String(far) } as CSSProperties}>
        <div
          className="b-safe"
          data-comp={plan.comp}
          data-mats={plan.mats}
          style={{
            '--b-hero-n': String(budget.hero),
            '--b-hero-gap-n': String(budget.heroGap),
            '--b-band-n': String(budget.band),
            '--b-panel-n': String(budget.panel),
            '--b-mat-gap-n': String(budget.matGap),
            '--b-row-n': String(budget.row),
            '--lb-rows': String(budget.lbRows),
            '--lb-gap-n': String(budget.lbGap),
          } as CSSProperties}
        >
          {snapshot === null || plan.comp === 'cold'
            ? <HeroSkeleton />
            : <Hero teams={snapshot.teams} leaderboard={snapshot.leaderboard} />}

          {/* G27: on a desk event no mat runs anything, so the head names the running
              order the room will actually see rather than an arrangement of mats. */}
          {snapshot !== null && plan.comp === 'setup' && (snapshot.event.mode === 'entry'
            ? <OrderBand mats={snapshot.mats} matches={snapshot.matches} firstUp={budget.queue} />
            : <SetupBand mats={snapshot.mats} firstUp={budget.queue} />)}
          {snapshot !== null && plan.comp === 'mats' && (
            <MatBand
              mats={snapshot.mats.slice(0, budget.matsShown)}
              matches={snapshot.matches}
              held={held}
              settled={settled}
              serverNow={snapshot.now}
              teamColor={teamColor}
              withClock={budget.clock}
              nextCount={budget.queue}
              lastSuccessAt={lastSuccessAt}
              pollIntervalMs={pollIntervalMs}
            />
          )}
          {snapshot !== null && plan.comp === 'entry' && (
            <ResultsBand results={entryRows} total={done.length} settled={settled} teamColor={teamColor} />
          )}
          {snapshot !== null && plan.comp === 'done' && (
            <DoneBand teams={snapshot.teams} leaderboard={snapshot.leaderboard} />
          )}
          {snapshot === null && <div className="b-band" />}

          {notes.length > 0 && (
            <div role="status" className="b-note font-sans">
              {notes.map(note => <span key={note}>{note}</span>)}
            </div>
          )}

          {certifiedAt !== null && (
            <div className="b-sign font-sans">
              {CERTIFIED_NOTE} <span className="b-sign-at font-mono">{certifiedAt}</span>
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
