import type { MatView } from '@shared/types'
import { NextLine } from './MatRow'

const FIRST_UP = 3

/**
 * 6.15's setup composition. Twenty minutes before the first whistle the hero is 0 to 0
 * and the room's question is who is on first, so the band becomes N columns, each a b3
 * head over that mat's first three pairings. This is the only composition where queue
 * depth fits at the legibility floor, and it is the one moment the queue is wanted.
 */
export function SetupBand({ mats }: { mats: MatView[] }) {
  return (
    <div className="b-band">
      {mats.map(mat => (
        <section key={mat.id} aria-label={`Mat ${mat.number}`} className="b-panel">
          <div className="b-setup-head font-sans">{`Mat ${mat.number} first up`}</div>
          {mat.onDeck.slice(0, FIRST_UP).map(match => (
            <NextLine key={match.id} a={match.a} b={match.b} />
          ))}
        </section>
      ))}
    </div>
  )
}
