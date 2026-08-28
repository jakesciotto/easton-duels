import { RadioGroup } from "@base-ui/react/radio-group"
import { Radio } from "@base-ui/react/radio"

import { cn } from "@/lib/utils"

export type SegmentOption = { value: string; label: string }

function Segment({ value, onValueChange, options, className, "aria-label": ariaLabel }: {
  value: string
  onValueChange: (value: string) => void
  options: SegmentOption[]
  className?: string
  "aria-label": string
}) {
  return (
    <RadioGroup
      data-slot="segment"
      value={value}
      onValueChange={v => onValueChange(v)}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-full border border-border bg-card p-1",
        className
      )}
    >
      {options.map(o => (
        <Radio.Root
          key={o.value}
          value={o.value}
          className="rounded-full px-4 py-2 text-center text-sm font-medium text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/12 data-checked:bg-primary data-checked:font-semibold data-checked:text-primary-foreground"
        >
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}

export { Segment }
