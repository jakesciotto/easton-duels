import type { MatView, MatchView } from '@shared/types'
import { isRunning } from '@shared/clock'
import { MatRow, NextLine } from './MatRow'

// One mat, one panel, in the same position for the whole event: mat 1 is the top row
// whether it is live, idle or finished.
function MatPanel({ mat, held, settled, serverNow, nextCount, withClock }: {
  mat: MatView
  held: MatchView | undefined
  settled: boolean
  serverNow: string | null
  nextCount: number
  withClock: boolean
}) {
  const current = mat.current
  const showing = current ?? held ?? null
  const finished = showing !== null && showing.status === 'done'
  const upcoming = showing === null ? mat.onDeck[0] ?? null : null
  const subject = showing ?? upcoming
  const live = current !== null && !finished && isRunning(current.clock)

  // The queue starts after whatever the row is already showing.
  const queue = (showing === null ? mat.onDeck.slice(1) : mat.onDeck).slice(0, nextCount)

  return (
    <section aria-label={`Mat ${mat.number}`} className="b-panel">
      <MatRow
        matNumber={mat.number}
        a={subject?.a ?? null}
        b={subject?.b ?? null}
        live={live}
        settled={finished && settled}
        upcoming={showing === null && upcoming !== null}
        withClock={withClock}
        clock={withClock && current !== null && !finished ? current.clock : null}
        serverNow={serverNow}
      />
      {queue.length > 0 && (
        <div className="b-next">
          {queue.map(m => <NextLine key={m.id} a={m.a} b={m.b} />)}
        </div>
      )}
    </section>
  )
}

/**
 * Above two mats this is a ledger of full safe-width rows, not a tile grid. A four
 * column grid on a 1728px safe area leaves about four characters per name, so four
 * mats and readable names do not coexist in a grid on a 16:9 stage. The per mat clock
 * is what pays for the name field, which is why it is deleted at three and four mats
 * and kept at one and two.
 */
export function MatBand({ mats, held, settled, serverNow }: {
  mats: MatView[]
  held: ReadonlyMap<number, MatchView>
  settled: ReadonlySet<number>
  serverNow: string | null
}) {
  const withClock = mats.length <= 2
  const nextCount = mats.length === 1 ? 4 : mats.length === 2 ? 1 : 0
  return (
    <div className="b-band">
      {mats.map(mat => {
        const showing = mat.current ?? held.get(mat.id) ?? null
        return (
          <MatPanel
            key={mat.id}
            mat={mat}
            held={held.get(mat.id)}
            settled={showing !== null && settled.has(showing.id)}
            serverNow={serverNow}
            nextCount={nextCount}
            withClock={withClock}
          />
        )
      })}
    </div>
  )
}
