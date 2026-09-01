import type { CSSProperties } from 'react'
import { TEAM_COLORS, type TeamColor, type WinType } from '@shared/types'

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
