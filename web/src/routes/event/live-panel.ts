import type { EventStatus, MatView, MatchView } from '@shared/types'
import { winTypeLabel } from '@/lib/format'

// 6.9 / 7.3. The Live tab is N permanent mat panels whose geometry never moves, so
// everything that varies is a value in this model rather than a branch in the JSX.
// Keeping it pure also keeps the state machine testable without a DOM.

export type PanelTone = 'live' | 'attend' | 'neutral'

export interface PanelControl {
  label: string
  // 7.7: the panel's primary is `lg` (40px). `attend` repaints it; `secondary` is the
  // neutral frequent action; an inert control still holds the slot and says why.
  tone: 'attend' | 'secondary'
  disabled: boolean
}

export interface PanelModel {
  tone: PanelTone
  // Section 8: colour is the second channel. Every state is readable from this word
  // before any hue is applied.
  word: string
  control: PanelControl
  // The NEXT lane never renders an information-free blank: with nothing on deck it
  // names the mat and says what is missing.
  queueNote: string | null
}

const inert = (label: string): PanelControl => ({ label, tone: 'secondary', disabled: true })

// A tie with no terminal on the board cannot be ended without a person naming the
// winner (the server answers 422 decision_required), so the desk asks first.
export function needsDecision(match: MatchView): boolean {
  return match.pendingTerminal === null && match.a.score === match.b.score
}

export function matPanelModel(mat: MatView, eventStatus: EventStatus, expired: boolean): PanelModel {
  const current = mat.current
  if (current !== null) {
    const running = current.clock.startedAt !== null && !expired
    return {
      tone: expired || !mat.bound ? 'attend' : running ? 'live' : 'neutral',
      word: expired ? 'Time expired'
        : !mat.bound ? 'No scorer'
        : running ? 'Live'
        : current.clock.elapsedMs > 0 ? 'Paused' : 'Ready',
      control: expired
        ? { label: 'Time expired. Record result', tone: 'attend', disabled: false }
        : { label: 'End match', tone: 'secondary', disabled: false },
      queueNote: mat.onDeck.length > 0 ? null : `Nothing else queued on mat ${mat.number}`,
    }
  }
  if (eventStatus === 'setup') {
    return {
      tone: 'neutral',
      word: 'Not started',
      control: inert('Waiting for the event to start'),
      queueNote: mat.onDeck.length > 0 ? null : `Nothing queued on mat ${mat.number} yet`,
    }
  }
  // A live event with a queue and nothing bound is a state only a person can clear:
  // the server binds the next match when one ends or is skipped, and neither has
  // happened here.
  if (mat.onDeck.length > 0) {
    return {
      tone: 'attend',
      word: 'Nothing bound',
      control: inert(`Nothing is bound to mat ${mat.number}`),
      queueNote: null,
    }
  }
  // The lane and the control never say the same sentence twice: the lane reports the
  // queue, the control reports what it could do and cannot.
  return {
    tone: 'neutral',
    word: 'Complete',
    control: inert('Nothing left to record'),
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

// The remainder line still states the depth "when is my kid up" exists to answer, at
// a bounded height instead of an unbounded one.
export function queueRemainderLabel(count: number): string {
  return `${count} more ${count === 1 ? 'match' : 'matches'} queued`
}
