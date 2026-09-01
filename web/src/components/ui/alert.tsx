import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

type AlertVariant = "fault" | "attend"

// 7.12, fully specified: a neutral recessed band plus a 3px full strength
// edge and heading colour. No tint: the previous fault-tinted background
// composited to 1.12-1.23:1 and was invisible under a gym veil.
const alertVariants = cva("grid gap-1 rounded-r-md border-l-[3px] bg-gray-1 px-4 py-3", {
  variants: {
    variant: {
      fault: "border-fault",
      attend: "border-attend",
    },
  },
  defaultVariants: { variant: "fault" },
})

const headingColor: Record<AlertVariant, string> = {
  fault: "text-fault",
  attend: "text-attend",
}

function Alert({
  className,
  variant = "fault",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({
  className,
  variant = "fault",
  ...props
}: React.ComponentProps<"p"> & { variant?: AlertVariant }) {
  return (
    <p
      data-slot="alert-title"
      className={cn("t3 font-medium!", headingColor[variant], className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p data-slot="alert-description" className={cn("t3 text-gray-11", className)} {...props} />
  )
}

export { Alert, AlertTitle, AlertDescription }
