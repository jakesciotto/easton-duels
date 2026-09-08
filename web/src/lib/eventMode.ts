import type { EventMode, EventStatus, Snapshot } from '@shared/types'
import { ApiError } from '@/lib/api'
import type { SegmentOption } from '@/components/ui/segment'

/**
 * One vocabulary and one order for the one setting, imported by every surface that names
 * it or sets it.
 *
 * The New event dialog offered "Live scoring" then "Data entry" and the event shell
 * offered "Runs from the desk" then "Scored on mats": different words for the same two
 * things, in the opposite order, on the two screens an organizer moves between on the
 * morning of the event. An organizer who picked the left option in one had to read
 * carefully to avoid picking the one they were already on in the other.
 *
 * The words kept are the ones a volunteer says out loud about the room, not the ones the
 * column says: an event is either scored on the mats or run from the desk. The order is
 * the mats first everywhere, because that is the column default and the way the pilot is
 * meant to run, so the second option is always the fallback.
 */
export const MODE_ORDER: readonly EventMode[] = ['live', 'entry']

export const MODE_LABEL: Record<EventMode, string> = {
  live: 'Scored on mats',
  entry: 'Runs from the desk',
}

export const MODE_HELP: Record<EventMode, string> = {
  live: 'A tablet on each mat scores every match. The desk corrects mistakes.',
  entry: 'The desk types every result by hand. No tablet scores a mat.',
}

export const MODE_GROUP_LABEL = 'How this event runs'

export const MODE_OPTIONS: SegmentOption[] = MODE_ORDER.map(value => ({ value, label: MODE_LABEL[value] }))

/** The one sentence every desk mode screen opens with, so three screens say one thing. */
export const DESK_LEAD = 'This event runs from the desk'

/** The connect page and the Live tab hand out a mat code, so both refuse in these words. */
export const DESK_NOTE = `${DESK_LEAD}, so no iPad scores a mat.`
export const DESK_NOTE_DETAIL =
  `Every result goes in on the Entry tab. Set this event to ${MODE_LABEL.live} to hand out a mat code.`

/** The volunteer's tablet has no Entry tab to send anyone to, so it says where the results go. */
export const DESK_BIND_REFUSAL =
  `${DESK_LEAD}. Every result is typed on the Entry tab, so there is no mat for this iPad to score.`

export function toMode(value: string): EventMode {
  return value === 'entry' ? 'entry' : 'live'
}

/**
 * One fact, one source. Every surface that already holds the polled stream reads the mode
 * out of it; the event detail is the fallback only where there is no stream yet, because
 * the detail is a react-query cache that refetches on a mutation or a window focus and
 * nothing invalidates it when another device patches the event. Two screens at one desk
 * were reading the two sources and stating different things about the same event.
 */
export function modeOf(snapshot: Snapshot | null, fallback: EventMode): EventMode {
  return snapshot?.event.mode ?? fallback
}

function matList(numbers: number[]): string {
  if (numbers.length === 1) return `mat ${numbers[0]}`
  return `mats ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
}

function asSentence(clause: string): string {
  return `${clause[0].toUpperCase()}${clause.slice(1)}`
}

/**
 * Why the desk cannot take this event over yet, or null when the switch is a plain tap.
 *
 * Only a clock that is actually running refuses. The earlier guard also refused for a
 * bound mat and for any mat carrying a match, and once an idle mat calls the next match
 * the instant one ends, every mat carries one all afternoon: the control was disabled for
 * the whole event and the desk fallback the setting exists to reach was unreachable. A
 * running clock is the one state where the switch would strand a referee mid bout, so it
 * is the one state that refuses (6.8), with the mat named.
 *
 * A mat holding a paused or not yet started match is a question rather than a refusal, and
 * deskSwitchMidMatch below is what the shell asks it with.
 *
 * A stream with no snapshot yet is refused too. The guard cannot see the mats, so the
 * honest answer for that one poll is the sentence the Live tab already prints for the
 * same silence.
 */
export function deskSwitchRefusal(snapshot: Snapshot | null): string | null {
  if (snapshot === null) return 'Waiting for the first update from the server.'
  const running = snapshot.mats.flatMap(m => (m.current !== null && m.current.clock.startedAt !== null ? [m.number] : []))
  if (running.length === 0) return null
  const said = asSentence(`${matList(running)} ${running.length === 1 ? 'has' : 'have'} a clock running`)
  return `${said}. The board drops the mat rack as soon as the desk takes over.`
}

/** A mat the switch would leave holding a match nobody can score. */
export interface MidMatchMat { number: number; pair: string }

/**
 * The mats that are mid-match with the clock stopped: paused between rounds, or bound and
 * waiting for the first whistle. Nothing is being stranded mid bout, so the switch is
 * allowed, but the result on each of them stops being the tablet's job the moment the
 * board repaints, which is a consequence an organizer has to be told once.
 */
export function deskSwitchMidMatch(snapshot: Snapshot | null): MidMatchMat[] {
  if (snapshot === null) return []
  return snapshot.mats
    .flatMap(m => {
      const current = m.current
      if (current === null || current.status === 'done' || current.clock.startedAt !== null) return []
      return [{ number: m.number, pair: `${current.a.name} vs ${current.b.name}` }]
    })
    .sort((x, y) => x.number - y.number)
}

/** The consequence, stated once for the whole set rather than repeated per mat. */
export function deskSwitchConsequence(mats: MidMatchMat[]): string {
  const numbers = mats.map(m => m.number)
  const said = asSentence(`${matList(numbers)} ${numbers.length === 1 ? 'is' : 'are'} mid-match`)
  const rest = numbers.length === 1
    ? 'Its result will have to be typed at the desk.'
    : 'Their results will have to be typed at the desk.'
  return `${said}. ${rest}`
}

/**
 * The Entry tab exists in both modes and means opposite things in them. On a live event
 * the tablets own every result and the desk is the fallback, so the tab says so where the
 * results go in: a volunteer who does not know it types a result the mat has already
 * recorded, and the team score counts it twice.
 */
export const MAT_NOTE = 'The mats own the results in this event. Type a result here only when a tablet has failed.'

/**
 * The Live tab keeps its mat rack in desk mode, because the running order per mat is
 * still what the desk reads to answer "when is my kid up". Each panel says why its NOW
 * lane is empty in DESK_NOTE's voice, so the rack never reads as a rack of failures.
 */
export const deskMatNote = (matNumber: number): string => `${DESK_LEAD}, so nothing scores mat ${matNumber}.`

/**
 * The event status as the room reports it, with the stored value until the first snapshot
 * lands. The detail is a react-query cache that nothing invalidates when a tablet ends a
 * match or a second device presses Finish, so a surface that decides "done" off it can
 * keep a scoreable form up over an event that is already over.
 */
export function statusOf(live: Snapshot | null, fallback: EventStatus): EventStatus {
  return live?.event.status ?? fallback
}

/**
 * Certified reads as done everywhere a layout is chosen: the board paints its Final
 * composition, the Live tab replaces the rack with the record, the Entry tab drops its
 * form, and the scorer shows its finished screen. The two states differ only in what may
 * still be changed, which is a separate question from what the screen looks like, so every
 * layout switch asks this and only the write surfaces ask which of the two it is.
 */
export function isFinished(status: EventStatus): boolean {
  return status === 'done' || status === 'certified'
}

/** 6.9's finished line, said in the same words by the Live tab and the Entry tab. */
export const FINISHED_LINE = 'This event is finished. Results can still be corrected until an admin certifies them.'

/** The Entry tab's certified line: the form is gone and so is the ledger's Edit. */
export const CERTIFIED_ENTRY_LINE = 'This event is certified. No result can change until an admin unlocks it.'

/**
 * The one sentence a refused write gets after certification, on every surface.
 *
 * The server answers `409 match_state` with `event is certified` from every write route,
 * and the raw message says what happened without saying what to do about it. Matching on
 * the server's own words is the contract `CERTIFIED_MESSAGE` states on the other side.
 */
export const CERTIFIED_REFUSAL_TITLE = 'This event is certified'
export const CERTIFIED_REFUSAL_BODY = 'Unlock it from the Live tab to change anything.'
export const CERTIFIED_REFUSAL = `${CERTIFIED_REFUSAL_TITLE}. ${CERTIFIED_REFUSAL_BODY}`

export function isCertifiedRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'match_state' && /event is certified/i.test(error.message)
}

/** The message a write surface prints, with the server's own sentence as the fallback. */
export function writeErrorMessage(error: Error): string {
  return isCertifiedRefusal(error) ? CERTIFIED_REFUSAL : error.message
}

/** The state word beside the mat number when the desk owns the results. */
export const DESK_PANEL_WORD = 'From the desk'

/**
 * The state word and the line under the pair on a mat the desk took over mid-bout.
 *
 * Switching to the desk leaves whatever was already on a mat exactly where it is, so the
 * panel has to name the pair and say where its result goes. The rack said "nothing scores
 * mat 2" and, one lane down, "Mat 2 complete", over two children who were still on it.
 */
export const DESK_MID_MATCH_WORD = 'Mid-match'
export const DESK_MID_MATCH_NOTE = 'Type this result on the Entry tab.'

/** 6.7: a ruleset is the tablet's vocabulary, and in desk mode no tablet reads it. */
export const DESK_RULESET_NOTE = 'Rulesets apply when tablets score the mats, and this event runs from the desk.'
