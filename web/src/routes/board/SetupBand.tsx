import type { MatView, MatchView } from '@shared/types'
import { NextLine } from './MatRow'

/** The head over the desk event's running order, where no mat runs anything. */
export const UP_NEXT_HEAD = 'Up next'

/** A head with nothing under it reads as a board that failed to load. */
export const NOT_DRAWN = 'Not drawn yet'

/**
 * 6.15's setup composition. Twenty minutes before the first whistle the hero is 0 to 0
 * and the room's question is who is on first, so the band becomes N columns, each a b3
 * head over that mat's first three pairings. This is the only composition where queue
 * depth fits at the legibility floor, and it is the one moment the queue is wanted.
 *
 * `firstUp` is budget.ts's, because a deeper room leaves the column less depth: three
 * pairings at far 1, two once the knob and a note have both taken their lines.
 */
export function SetupBand({ mats, firstUp = 3 }: { mats: MatView[]; firstUp?: number }) {
  return (
    <div className="b-band">
      {mats.map(mat => (
        <section key={mat.id} aria-label={`Mat ${mat.number}`} className="b-panel">
          <div className="b-setup-head font-sans">{`Mat ${mat.number} first up`}</div>
          {mat.onDeck.length === 0
            // A head with nothing under it reads as a board that failed to load. Before
            // the matches are drawn there is genuinely nothing to list, and the room is
            // owed that sentence rather than an empty column.
            ? <div className="b-setup-empty font-sans">{NOT_DRAWN}</div>
            : mat.onDeck.slice(0, firstUp).map(match => (
              <NextLine key={match.id} a={match.a} b={match.b} />
            ))}
        </section>
      ))}
    </div>
  )
}

/**
 * G27. The same moment on a desk event, where the mat label names a thing the room never
 * sees: nothing runs on a mat, so "Mat 2 first up" describes an arrangement that exists
 * only in the designer. The band keeps the same geometry and the same budget, one b3 head
 * and its gap then `firstUp` pairing lines, and spends them on one head over the whole
 * band and the event's own running order flowing down the columns.
 *
 * Columns fill down before across, so reading the board is reading the order.
 */
export function OrderBand({ mats, matches, firstUp = 3 }: {
  mats: MatView[]
  matches: MatchView[]
  firstUp?: number
}) {
  const order = matches.filter(m => m.status === 'pending').sort((x, y) => x.orderIndex - y.orderIndex)
  // Never more columns than the event has mats, and never an empty one at the tail: a
  // column with nothing in it under a head already spent reads as a load failure.
  const columns = order.length === 0 || firstUp === 0
    ? 1
    : Math.min(Math.max(1, mats.length), Math.ceil(order.length / firstUp))

  return (
    <div className="b-band b-band-order">
      <div className="b-setup-head font-sans">{UP_NEXT_HEAD}</div>
      <div className="b-order">
        {Array.from({ length: columns }, (_, i) => (
          <section key={i} aria-label={`Up next, column ${i + 1}`} className="b-panel">
            {order.length === 0
              ? <div className="b-setup-empty font-sans">{NOT_DRAWN}</div>
              : order.slice(i * firstUp, (i + 1) * firstUp).map(match => (
                <NextLine key={match.id} a={match.a} b={match.b} />
              ))}
          </section>
        ))}
      </div>
    </div>
  )
}
