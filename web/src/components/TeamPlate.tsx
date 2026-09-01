import { TEAM_COLOR_LABELS, teamCode, type TeamColor } from '@shared/types'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'

const SIZES = {
  // A list row, beside a name that is already the subject of its row.
  inline: 'h-4 px-[5px] text-[10px] rounded-[3px]',
  // A card head or a toolbar, where the plate identifies the whole block.
  desk: 'h-[18px] px-1.5 text-[11px] rounded-[4px]',
  // The scorer, read at arm's length by somebody who is watching the mat.
  scorer: 'h-7 px-2 text-sm rounded-[4px]',
} as const

export type PlateSize = keyof typeof SIZES

/**
 * Team identity carries three redundant channels at all times: a fixed position
 * (Team A is left and first on every surface, all afternoon), the code and the
 * name as words, and the colour fill. Colour never carries identity alone, so the
 * plate still reads under deuteranopia and at a distance where a dot is
 * physically unresolvable.
 */
export function TeamPlate({ color, name, size = 'desk', showName = true, className }: {
  color: TeamColor | string
  name: string
  size?: PlateSize
  showName?: boolean
  className?: string
}) {
  const code = teamCode(name)
  const label = TEAM_COLOR_LABELS[color as TeamColor]
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span
        style={teamStyle(color)}
        aria-hidden
        className={cn(
          'inline-grid shrink-0 place-items-center bg-[var(--team)] font-mono font-semibold leading-none tracking-[0.04em] text-gray-1',
          SIZES[size],
        )}
      >
        {code}
      </span>
      {showName && <span className="truncate font-medium text-gray-12">{name}</span>}
      <span className="sr-only">{label}</span>
    </span>
  )
}
