import type { EventMode, EventStatus, MatView, MatchView } from '@shared/types'
import { DESK_PANEL_WORD, deskMatNote } from '@/lib/eventMode'
import { winTypeLabel } from '@/lib/format'

// 6.9 / 7.3. The Live tab is N permanent mat panels whose geometry never moves, so
// everything that varies is a value in this model rather than a branch in the JSX.
// Keeping it pure also keeps the state machine testable without a DOM.

export type PanelTone = 'live' | 'attend' | 'neutral'

/** What pressing the panel's one control does. */
export type PanelAction = 'end' | 'advance'

export interface PanelControl {
  label: string
  // 7.7: the panel's primary is `lg` (40px). `attend` repaints it; `secondary` is the
  // neutral frequent action; an inert control still holds the slot and says why.
  tone: 'attend' | 'secondary'
  disabled: boolean
  /** Null on an inert control, which reports a state rather than offering a press. */
  action: PanelAction | null
}

export interface PanelModel {
  tone: PanelTone
  // Section 8: colour is the second channel. Every state is readable from this word
  // before any hue is applied.
  word: string
  /**
   * Null where the panel has nothing to offer at all. 7.10: a finished mat gets no
   * control rather than a disabled one, because a disabled button on every panel for
   * the rest of the afternoon is the information-free blank with a border around it.
   */
  control: PanelControl | null
  // The NOW lane's sentence when nothing is bound. It says why, and why differs by mode.
  nowNote: string
  // The NEXT lane never renders an information-free blank: with nothing on deck it
  // names the mat and says what is missing.
  queueNote: string | null
}

const inert = (label: string): PanelControl => ({ label, tone: 'secondary', disabled: true, action: null })

// A tie with no terminal on the board cannot be ended without a person naming the
// winner (the server answers 422 decision_required), so the desk asks first.
export function needsDecision(match: MatchView): boolean {
  return match.pendingTerminal === null && match.a.score === match.b.score
}

/**
 * @param mode how the event runs. In desk mode no tablet ever binds and no match ever
 * goes live, so every bound check would report a fault that is the configuration working
 * as designed: the rack read amber "No scorer" or "Nothing bound" on every panel for the
 * whole afternoon. The rack still earns its place there, because the running order per
 * mat is how the desk answers when a child is up, so the panel keeps its lanes and drops
 * only the parts that belong to a tablet.
 */
export function matPanelModel(mat: MatView, eventStatus: EventStatus, expired: boolean, mode: EventMode): PanelModel {
  const current = mat.current
  if (mode === 'entry') {
    return {
      tone: 'neutral',
      word: DESK_PANEL_WORD,
      control: null,
      nowNote: deskMatNote(mat.number),
      queueNote: mat.onDeck.length > 0 ? null : `Mat ${mat.number} complete`,
    }
  }
  if (current !== null) {
    const running = current.clock.startedAt !== null && !expired
    return {
      tone: expired || !mat.bound ? 'attend' : running ? 'live' : 'neutral',
      word: expired ? 'Time expired'
        : !mat.bound ? 'No scorer'
        : running ? 'Live'
        : current.clock.elapsedMs > 0 ? 'Paused' : 'Ready',
      control: expired
        ? { label: 'Time expired. Record result', tone: 'attend', disabled: false, action: 'end' }
        : { label: 'End match', tone: 'secondary', disabled: false, action: 'end' },
      nowNote: 'No match bound',
      queueNote: mat.onDeck.length > 0 ? null : `Nothing else queued on mat ${mat.number}`,
    }
  }
  if (eventStatus === 'setup') {
    return {
      tone: 'neutral',
      word: 'Not started',
      control: inert('Waiting for the event to start'),
      nowNote: 'No match bound',
      queueNote: mat.onDeck.length > 0 ? null : `Nothing queued on mat ${mat.number} yet`,
    }
  }
  // A live event, an idle mat and a queue behind it. The server binds the next match when
  // one ends or is skipped, and neither has happened here: a match added to this mat, or
  // moved onto it, or a mat created after Start, leaves nobody to trigger the advance. So
  // the panel's primary control IS the advance rather than a sentence saying it is stuck.
  if (mat.onDeck.length > 0) {
    return {
      tone: 'attend',
      word: 'Nothing bound',
      control: { label: 'Call the next match', tone: 'attend', disabled: false, action: 'advance' },
      nowNote: 'No match bound',
      queueNote: null,
    }
  }
  return {
    tone: 'neutral',
    word: 'Complete',
    control: null,
    nowNote: 'No match bound',
    queueNote: `Mat ${mat.number} complete`,
  }
}

function endedAtMs(match: MatchView): number | null {
  if (!match.endedAt) return null
  const ms = Date.parse(match.endedAt)
  return Number.isNaN(ms) ? null : ms
}

// The last settled match on this mat. endedAt is the record when the server has it;
// a match ended in this session before the next poll may not, so the running order
// decides between two stampless rows rather than a stamp beating a blank by accident.
export function lastResultOf(matches: MatchView[], matId: number): MatchView | null {
  let best: MatchView | null = null
  for (const match of matches) {
    if (match.matId !== matId || match.status !== 'done' || match.result === null) continue
    if (best === null) { best = match; continue }
    const a = endedAtMs(best)
    const b = endedAtMs(match)
    if (a !== null && b !== null) best = b >= a ? match : best
    else if (b !== null) best = match
    else if (a === null && match.orderIndex >= best.orderIndex) best = match
  }
  return best
}

export function winnerAndLoser(match: MatchView): { winner: MatchView['a']; loser: MatchView['a'] } | null {
  if (!match.result) return null
  const aWon = match.result.winnerAthleteId === match.a.athleteId
  return { winner: aWon ? match.a : match.b, loser: aWon ? match.b : match.a }
}

export function resultSentence(match: MatchView): string | null {
  const sides = winnerAndLoser(match)
  if (!sides || !match.result) return null
  return `${sides.winner.name} beat ${sides.loser.name} ${winTypeLabel(match.result.winType)}`
}

export function resultScore(match: MatchView): string | null {
  const sides = winnerAndLoser(match)
  return sides === null ? null : `${sides.winner.score}-${sides.loser.score}`
}

// 7.3 prints the settled time as "3:41 pm". An event never crosses noon and midnight
// both, so the hour needs no date beside it.
export function resultTime(endedAt: string | null | undefined): string | null {
  if (!endedAt) return null
  const at = new Date(endedAt)
  if (Number.isNaN(at.getTime())) return null
  const hour = at.getHours() % 12 || 12
  return `${hour}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'am' : 'pm'}`
}

// "Paused, 1 update waiting" reads wrong at every other count, and the count is the
// one number in the toolbar a person acts on.
export function waitingLabel(count: number): string {
  return `Paused, ${count} update${count === 1 ? '' : 's'} waiting`
}

// 6.9: the NEXT lane's queue is capped at four pairs so a deep rack cannot push the
// panel's primary control (the one control the panel exists to hold) below the fold.
// Finding 1: rendering the whole remaining on-deck list gave a two mat event with 40
// generated matches about 20 lines on one mat's queue.
export const NEXT_QUEUE_CAP = 4

/**
 * How many matches are still waiting on this mat, from the whole match list rather than
 * from `onDeck`.
 *
 * `onDeck` is capped at ON_DECK_DEPTH (five) by the serializer, and the panel already
 * shows one pair plus four lines, so a remainder derived from it was always zero and the
 * depth line was dead code. Depth is the one thing this surface can hold that the board
 * cannot, so it is counted from the source that knows it.
 */
export function pendingQueueDepth(matches: MatchView[], mat: MatView): number {
  const currentId = mat.current?.id ?? null
  return matches.filter(m => m.matId === mat.id && m.status === 'pending' && m.id !== currentId).length
}

// The remainder line still states the depth "when is my kid up" exists to answer, at
// a bounded height instead of an unbounded one. It is the tail of the list above it,
// so it reads as one more line of that list rather than as its own sentence.
export function queueRemainderLabel(count: number): string {
  return `and ${count} more`
}
