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
        "inline-grid w-fit auto-cols-fr grid-flow-col rounded-lg border border-border bg-background p-[3px]",
        className
      )}
    >
      {options.map(o => (
        <Radio.Root
          key={o.value}
          value={o.value}
          aria-label={o.label}
          className="rounded-[5px] px-3.5 py-[5px] text-center text-[13px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:text-foreground focus-visible:shadow-focus data-checked:bg-input data-checked:text-foreground"
        >
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}

export { Segment }
