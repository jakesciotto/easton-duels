import type { MatchView } from '@shared/types'
import { MatRow } from './MatRow'

/**
 * The composition the pilot actually runs, and it is a final score panel rather than a
 * degraded live board. It carries less data than live mode, so it can afford the
 * biggest hero in the app. The newest row carries its change cue, then joins a
 * monotone list.
 */
export function ResultsBand({ results, total, settled }: {
  results: MatchView[]
  total: number
  settled: ReadonlySet<number>
}) {
  return (
    <>
      <div className="b-band">
        {results.map((match, i) => (
          <section key={match.id} aria-label={`Result ${i + 1}`} className="b-panel">
            <MatRow a={match.a} b={match.b} settled={settled.has(match.id)} />
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
