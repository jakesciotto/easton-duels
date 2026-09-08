import { useState } from 'react'
import type { ClockState, MatchSide } from '@shared/types'
import { formatClock, remainingMs as remainingAt } from '@shared/clock'
import { useClock, useServerOffset } from '@/lib/useClock'
import { POLL_CLOCK_RUNNING_MS } from '@/lib/pollInterval'
import { cn } from '@/lib/utils'
import { boardName } from './names'

const NEAR_EXPIRY_MS = 30_000

/**
 * A figure crossfades whole when its value changes and never interpolates. Two slots
 * that both stay mounted are what makes it a crossfade rather than a fade in: keying a
 * single span on the value unmounts the old numeral in the same commit, so the room
 * only ever saw the new one arrive out of nothing. The incoming slot takes the value,
 * the outgoing one keeps the old digits while it fades, and because both elements
 * persist the cue is a CSS transition, which is the form 4.3 keeps under Reduce Motion.
 */
export function Fig({ value, className }: { value: number | string; className?: string }) {
  const text = String(value)
  const [state, setState] = useState(() => ({ slots: [text, ''] as [string, string], active: 0, shown: text }))
  if (state.shown !== text) {
    const active = state.active === 0 ? 1 : 0
    const slots: [string, string] = active === 0 ? [text, state.slots[1]] : [state.slots[0], text]
    setState({ slots, active, shown: text })
  }
  return (
    <span className={cn('b-fig', className)}>
      {state.slots.map((slot, i) => (
        <span
          key={i}
          aria-hidden={i !== state.active}
          className={i === state.active ? 'b-fig-on' : undefined}
        >
          {slot}
        </span>
      ))}
    </span>
  )
}

export function figTone(mine: number, theirs: number): string {
  return mine >= theirs ? 'b-lead' : 'b-trail'
}

/**
 * The tone for one side of a row's score, and for its name once the row has settled.
 *
 * A live row is read by score, because the score is what the room is watching change. A
 * finished row is read by the recorded winner, because the score is not what settled it:
 * a submission at 0 to 0 gave both sides the lead tone and the row showed no winner at
 * all, which is the one thing a result row exists to say.
 *
 * After the ten second hold the winner keeps the settled row's --gray-11 and the loser
 * drops one step to --gray-10. That is the floor 3.4 allows, it keeps the settled row as
 * quiet as 6.15 asks, and a parent walking in late can still tell who won.
 */
export function rowTone(won: boolean | null, mine: number, theirs: number, settled: boolean): string | null {
  if (won === null) return settled ? null : figTone(mine, theirs)
  if (settled) return won ? null : 'b-fade'
  return won ? 'b-lead' : 'b-trail'
}

export function BoardName({ full, side, className }: { full: string; side: 'a' | 'b'; className?: string }) {
  const { first, last } = boardName(full)
  return (
    <span className={cn('b-name font-sans', side === 'a' ? 'b-name-a' : 'b-name-b', className)}>
      <span className="b-name-first">{first}</span>
      {last && <span className="b-name-last">{` ${last}`}</span>}
    </span>
  )
}

/**
 * 7.6's five states, on the board's own scale. Whole seconds only, no colour
 * transition, no interpolation between polls: the server writes clock_pause at the
 * expiry instant and a smoothed client clock would disagree with it at exactly the
 * moment that matters.
 *
 * Past three missed polls the readout freezes at the value the last snapshot actually
 * carried, computed from `lastSuccessAt` rather than from the device clock. A frozen
 * board is pixel identical to a working one, so a board that keeps counting through an
 * outage is the single failure this state exists to prevent.
 */
function BoardClock({ clock, serverNow, lastSuccessAt, pollIntervalMs }: {
  clock: ClockState
  serverNow: string | null
  lastSuccessAt: number | null
  pollIntervalMs: number
}) {
  const offset = useServerOffset(serverNow)
  const { remainingMs, running, stale } = useClock(clock, serverNow, lastSuccessAt, pollIntervalMs)
  const frozen = stale && lastSuccessAt !== null
  const shown = frozen ? remainingAt(clock, lastSuccessAt + offset) : remainingMs
  const state = stale ? 'b-clock-stale'
    : shown <= 0 ? 'b-clock-expired'
    : !running ? 'b-clock-paused'
    : shown <= NEAR_EXPIRY_MS ? 'b-clock-near'
    : null
  return <span className={cn('b-clock', state)}>{formatClock(shown)}</span>
}

export interface MatRowProps {
  a: MatchSide | null
  b: MatchSide | null
  matNumber?: number
  scores?: boolean
  live?: boolean
  settled?: boolean
  upcoming?: boolean
  /** The recorded winner on a finished row. Null on a row that has not settled anything,
      which is what tells the row to read its tones off the scores instead. */
  winnerAthleteId?: number | null
  /** What a row with no pair at all says, in the name track: "Mat 3 complete" (7.10). */
  note?: string | null
  /** Reserves the clock track. Held independently of `clock` so a row keeps its column
      geometry when the match on it finishes and the clock stops being shown. */
  withClock?: boolean
  clock?: ClockState | null
  serverNow?: string | null
  /** 7.6: the timestamp of the last poll that reached the server, and the interval it
      is measured against. Without them the clock cannot know it has gone quiet. */
  lastSuccessAt?: number | null
  pollIntervalMs?: number
}

/**
 * One mirrored row: each name sits beside its own score and the two scores meet at the
 * centre, so the pair groups before the eye reads a digit. The leading gutter is the
 * only place --live appears on the board.
 */
export function MatRow({
  a, b, matNumber, scores = true, live = false, settled = false, upcoming = false,
  winnerAthleteId = null, note = null,
  withClock = false, clock = null, serverNow = null,
  lastSuccessAt = null, pollIntervalMs = POLL_CLOCK_RUNNING_MS,
}: MatRowProps) {
  const showScores = scores && a !== null && b !== null && !upcoming
  const wonA = !showScores || winnerAthleteId === null || a === null ? null : a.athleteId === winnerAthleteId
  const toneA = !showScores || a === null || b === null ? null : rowTone(wonA, a.score, b.score, settled)
  const toneB = !showScores || a === null || b === null ? null : rowTone(wonA === null ? null : !wonA, b.score, a.score, settled)
  // 7.5 scopes the lead and trail tones to the score display, and a name on this board is
  // the largest text in the room: taking --fig-trail dropped the competitor who is behind
  // to --gray-10 on the one line a parent across the gym is reading. Only the settled row
  // tones its names, where the step down is what names the winner after the hold.
  const nameToneA = settled ? toneA : null
  const nameToneB = settled ? toneB : null
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
      {/* 7.10: a mat with nothing on it and nothing left to call says so. Before this it
          rendered the gutter and the numeral alone, so after a reload every mat that had
          finished was a blank row for the rest of the afternoon. */}
      {note !== null && <span className="b-row-note font-sans">{note}</span>}
      {a && <BoardName full={a.name} side="a" className={nameToneA ?? undefined} />}
      {showScores && a && b && <Fig className={cn('b-score b-score-a', toneA)} value={a.score} />}
      {clock && (
        <BoardClock
          clock={clock}
          serverNow={serverNow}
          lastSuccessAt={lastSuccessAt}
          pollIntervalMs={pollIntervalMs}
        />
      )}
      {showScores && a && b && <Fig className={cn('b-score b-score-b', toneB)} value={b.score} />}
      {b && <BoardName full={b.name} side="b" className={nameToneB ?? undefined} />}
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
