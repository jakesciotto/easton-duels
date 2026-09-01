import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // 7.9: a 16px glyph inside a 24px hit area (WCAG 2.2 SC 2.5.8). The
        // pseudo-element extends the tap target without changing the glyph box.
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-gray-8 bg-card transition-[color,background-color,box-shadow] duration-150 ease-standard outline-none before:absolute before:-inset-1 before:content-[''] focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 data-checked:border-primary data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex text-primary-foreground"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
