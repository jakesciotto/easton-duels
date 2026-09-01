import type { EventMode, Snapshot } from '@shared/types'
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

/**
 * Why the desk cannot take this event over yet, or null when the switch is a plain tap.
 *
 * Switching to the desk repaints the television as the Final Score panel within one poll,
 * so a mat that is bound to a tablet or carrying a match would go on being scored by a
 * room that can no longer see it. Refuse rather than ask (6.8): the control is disabled
 * and this sentence is printed beside it, naming the mat, instead of a dialog asking an
 * organizer to confirm something they reached for by accident.
 *
 * A stream with no snapshot yet is refused too. The guard cannot see the mats, and the
 * event detail says nothing about which of them hold a tablet, so the honest answer for
 * that one poll is the sentence the Live tab already prints for the same silence.
 */
export function deskSwitchRefusal(snapshot: Snapshot | null): string | null {
  if (snapshot === null) return 'Waiting for the first update from the server.'
  const bound = snapshot.mats.filter(m => m.bound).map(m => m.number)
  const running = snapshot.mats.filter(m => !m.bound && m.current !== null).map(m => m.number)
  if (bound.length === 0 && running.length === 0) return null
  const clauses = [
    bound.length > 0 ? `${matList(bound)} ${bound.length === 1 ? 'has' : 'have'} an iPad connected` : null,
    running.length > 0 ? `${matList(running)} ${running.length === 1 ? 'is' : 'are'} on a match` : null,
  ].filter((clause): clause is string => clause !== null)
  const said = clauses.map(clause => `${clause[0].toUpperCase()}${clause.slice(1)}.`).join(' ')
  return `${said} The board drops the mat rack as soon as the desk takes over.`
}
