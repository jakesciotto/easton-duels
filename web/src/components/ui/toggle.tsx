import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Replaces the hand rolled aria-pressed button typed by hand at three
// different heights (EntryTab, ConfirmSheet, ResultDialog) and MatPickPage's
// fourth invented style. base-ui sets aria-pressed and data-pressed itself.
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border border-gray-7 bg-transparent t3 font-medium! text-gray-11 transition-[color,background-color,border-color,box-shadow] duration-150 ease-standard outline-none select-none focus-visible:shadow-focus active:scale-[0.97] active:duration-120 active:ease-out disabled:pointer-events-none disabled:opacity-50 aria-[pressed=false]:hover:bg-gray-3 aria-[pressed=false]:hover:text-white aria-[pressed=false]:active:bg-gray-4 aria-pressed:border-gray-8 aria-pressed:bg-gray-5 aria-pressed:text-white",
  {
    variants: {
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-3.5",
        mat: "h-[104px] px-5",
      },
    },
    defaultVariants: { size: "md" },
  }
)

function Toggle({
  className,
  size = "md",
  ...props
}: TogglePrimitive.Props<string> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ size }), className)}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
