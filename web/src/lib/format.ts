import type { CSSProperties } from 'react'
import { TEAM_COLORS, type EventContact, type TeamColor, type WinType } from '@shared/types'

export function beltLabel(belt: string | null): string {
  if (!belt) return 'No belt'
  return belt.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' / ')
}

export function athleteName(a: { firstName: string; lastName: string }): string {
  return `${a.firstName} ${a.lastName}`.trim()
}

export function winTypeLabel(w: WinType): string {
  return w === 'submission' ? 'by submission' : w === 'points' ? 'on points' : 'by decision'
}

// The only consumer is teamStyle, which assigns the result to a custom property,
// so the fallback stays a token reference rather than a literal.
export function teamHex(color: string): string {
  return TEAM_COLORS[color as TeamColor] ?? 'var(--gray-8)'
}

// Sets --team so Tailwind classes like bg-[var(--team)] and text-[var(--team)] pick the team colour.
export function teamStyle(color: string): CSSProperties {
  return { '--team': teamHex(color) } as CSSProperties
}

// The column is free text up to ten characters, and the roster sync writes "Male" while a
// hand entry writes "M". The roster row prints it inside a line that must never wrap, so a
// four letter value costs the rating its place. Display only: the stored value never changes.
export function genderLabel(gender: string | null): string | null {
  if (!gender) return null
  const first = gender.trim().charAt(0).toUpperCase()
  return first === '' ? null : first
}

/**
 * 6.4's footer line, printed identically wherever a volunteer might need the desk: the
 * connect page, the scorer's reference region and its done screen. Null when the event
 * carries no contact, because a half filled one gives nobody anything to act on.
 */
export function contactLine(contact: EventContact | null): string | null {
  if (!contact) return null
  return `Questions at the desk: ${contact.name}, ${contact.phone}.`
}

/**
 * "3:41 pm". One formatter for every surface that stamps a time of day: the mat panel's
 * last result, the Result dialog's statement of what is being corrected, and the board's
 * certified note. An event never crosses noon and midnight both, so the hour needs no
 * date beside it.
 */
export function timeOfDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const hour = at.getHours() % 12 || 12
  return `${hour}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'am' : 'pm'}`
}
