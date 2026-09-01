import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A ledger field: a group of rows under one head, which is what the four dense
 * screens are made of.
 *
 * `data-frame` decides whether the group draws a box. The ruled frame is the one
 * the owner approved: no box at rest, a recessed head band, and a 2px boundary
 * only where a boundary means something. A 1px rule on this ground is 1.80:1
 * under a gym veil and sits near the acuity limit at desk distance, so structure
 * comes from alignment first and from a line last.
 *
 * The card frame stays reachable because a screen converts to the Ledger Grid
 * structurally before it changes how it looks, so a half migrated app never
 * reads as unfinished and a rollback is one attribute.
 */
function FieldSet({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-set"
      data-frame="ruled"
      className={cn(
        "min-w-0 overflow-hidden rounded-lg",
        "data-[frame=ruled]:border-2 data-[frame=ruled]:border-transparent",
        "data-[frame=card]:border data-[frame=card]:border-border data-[frame=card]:bg-card",
        "transition-colors duration-150 ease-standard",
        className
      )}
      {...props}
    />
  )
}

/**
 * The head carries the column labels once, instead of every row repeating them.
 * A numeric column adds the `tick` class, which marks where its digits end.
 */
function FieldHead({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-head"
      className={cn(
        "h-8 items-center bg-gray-1 px-3 t1 uppercase text-gray-10",
        className
      )}
      {...props}
    />
  )
}

function FieldRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-row"
      className={cn(
        "items-center border-t border-gray-7 px-3 first-of-type:border-t-0",
        "transition-colors duration-120 ease-out",
        "hover:bg-accent active:bg-accent-press data-[selected=true]:bg-accent-press",
        className
      )}
      {...props}
    />
  )
}

export { FieldSet, FieldHead, FieldRow }
