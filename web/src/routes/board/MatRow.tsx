import type { ClockState, MatchSide } from '@shared/types'
import { formatClock } from '@shared/clock'
import { useClock } from '@/lib/useClock'
import { cn } from '@/lib/utils'
import { boardName } from './names'

/**
 * A figure crossfades whole when its value changes and never interpolates. The key is
 * what forces the remount: without it React patches the text node in place and the
 * change lands with no cue at all.
 */
export function Fig({ value, className }: { value: number | string; className?: string }) {
  return (
    <span key={String(value)} className={cn('b-fig', className)}>
      {value}
    </span>
  )
}

export function figTone(mine: number, theirs: number): string {
  return mine >= theirs ? 'b-lead' : 'b-trail'
}

export function BoardName({ full, side }: { full: string; side: 'a' | 'b' }) {
  const { first, last } = boardName(full)
  return (
    <span className={cn('b-name font-sans', side === 'a' ? 'b-name-a' : 'b-name-b')}>
      <span className="b-name-first">{first}</span>
      {last && <span className="b-name-last">{` ${last}`}</span>}
    </span>
  )
}

// Whole seconds only, no colour transition, no interpolation between polls. The server
// writes clock_pause at the expiry instant and a smoothed client clock would disagree
// with it at exactly the moment that matters.
function BoardClock({ clock, serverNow }: { clock: ClockState; serverNow: string | null }) {
  const { remainingMs } = useClock(clock, serverNow)
  return <span className="b-clock">{formatClock(remainingMs)}</span>
}

export interface MatRowProps {
  a: MatchSide | null
  b: MatchSide | null
  matNumber?: number
  scores?: boolean
  live?: boolean
  settled?: boolean
  upcoming?: boolean
  /** Reserves the clock track. Held independently of `clock` so a row keeps its column
      geometry when the match on it finishes and the clock stops being shown. */
  withClock?: boolean
  clock?: ClockState | null
  serverNow?: string | null
}

/**
 * One mirrored row: each name sits beside its own score and the two scores meet at the
 * centre, so the pair groups before the eye reads a digit. The leading gutter is the
 * only place --live appears on the board.
 */
export function MatRow({
  a, b, matNumber, scores = true, live = false, settled = false, upcoming = false,
  withClock = false, clock = null, serverNow = null,
}: MatRowProps) {
  const showScores = scores && a !== null && b !== null && !upcoming
  return (
    <div
      className={cn(
        'b-row font-mono',
        withClock ? 'b-row-clock' : null,
        live ? 'b-row-live' : null,
        settled ? 'b-row-settled' : null,
        upcoming ? 'b-row-upcoming' : null,
      )}
    >
      <span className="b-gut" aria-hidden />
      {matNumber !== undefined && <span className="b-mat">{matNumber}</span>}
      {a && <BoardName full={a.name} side="a" />}
      {showScores && a && b && <Fig className={cn('b-score b-score-a', settled ? null : figTone(a.score, b.score))} value={a.score} />}
      {clock && <BoardClock clock={clock} serverNow={serverNow} />}
      {showScores && a && b && <Fig className={cn('b-score b-score-b', settled ? null : figTone(b.score, a.score))} value={b.score} />}
      {b && <BoardName full={b.name} side="b" />}
    </div>
  )
}

export function NextLine({ a, b }: { a: MatchSide; b: MatchSide }) {
  return (
    <div className="b-next-line">
      <BoardName full={a.name} side="a" />
      <BoardName full={b.name} side="b" />
    </div>
  )
}
