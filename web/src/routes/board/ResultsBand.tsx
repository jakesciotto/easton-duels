import type { MatchView } from '@shared/types'
import { MatRow } from './MatRow'

/**
 * 7.10, in the room's voice rather than the desk's. Between Start and the first result
 * the band held nothing at all, so a 55 inch screen in front of a full gym carried a
 * hero, a zero, and an empty half. This says what the room is waiting for.
 */
export const RESULTS_EMPTY = 'First results go up as they come off the mats.'

/**
 * The composition the pilot actually runs, and it is a final score panel rather than a
 * degraded live board. It carries less data than live mode, so it can afford the
 * biggest hero in the app. The newest row carries its change cue, then joins a
 * monotone list.
 */
export function ResultsBand({ results, total, settled, teamColor }: {
  results: MatchView[]
  total: number
  settled: ReadonlySet<number>
  teamColor: (teamId: number | null) => string | null
}) {
  return (
    <>
      <div className="b-band">
        {results.length === 0
          ? <div className="b-row-empty font-sans">{RESULTS_EMPTY}</div>
          : results.map((match, i) => (
            <section key={match.id} aria-label={`Result ${i + 1}`} className="b-panel">
              {/* Every row here is settled, so the tones come from the recorded winner:
                  a submission at 0 to 0 is the whole point of the desk composition and by
                  score it showed no winner at all. */}
              <MatRow
                a={match.a}
                b={match.b}
                settled={settled.has(match.id)}
                winnerAthleteId={match.result?.winnerAthleteId ?? null}
                colorA={teamColor(match.a.teamId)}
                colorB={teamColor(match.b.teamId)}
              />
            </section>
          ))}
      </div>
      <div className="b-footer font-sans">
        {'Results entered: '}
        <span className="font-mono">{total}</span>
      </div>
    </>
  )
}
