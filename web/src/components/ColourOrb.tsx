import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { TEAM_COLOR_KEYS, type TeamColor } from '@shared/types'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'

function colourLabel(color: string): string {
  return color.charAt(0).toUpperCase() + color.slice(1)
}

export function ColourOrb({ color, size = 30, className }: { color: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('team-grad inline-block shrink-0 rounded-full', className)}
      style={{ ...teamStyle(color), width: size, height: size }}
    />
  )
}

export function ColourOrbs({ value, onChange, 'aria-label': ariaLabel }: {
  value: TeamColor
  onChange: (color: TeamColor) => void
  'aria-label': string
}) {
  return (
    <RadioGroup value={value} onValueChange={v => onChange(v)} aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {TEAM_COLOR_KEYS.map(c => (
        <Radio.Root
          key={c}
          value={c}
          aria-label={colourLabel(c)}
          style={teamStyle(c)}
          className="team-grad size-[30px] rounded-full outline-none ring-offset-background transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 data-checked:ring-2 data-checked:ring-primary data-checked:ring-offset-2"
        />
      ))}
    </RadioGroup>
  )
}
