import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { TEAM_COLOR_KEYS, TEAM_COLOR_LABELS, type TeamColor } from '@shared/types'
import { teamStyle } from '@/lib/format'

export function ColourSwatches({ value, onChange, 'aria-label': ariaLabel }: {
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
          aria-label={TEAM_COLOR_LABELS[c]}
          style={teamStyle(c)}
          className="team-dot size-[18px] rounded-full outline-none transition-[box-shadow] duration-150 focus-visible:shadow-focus data-checked:ring-[1.5px] data-checked:ring-primary data-checked:ring-offset-2 data-checked:ring-offset-card"
        />
      ))}
    </RadioGroup>
  )
}
