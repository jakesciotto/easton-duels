import * as React from "react"

import { cn } from "@/lib/utils"

function List({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list"
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className
      )}
      {...props}
    />
  )
}

function ListRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-row"
      className={cn(
        "border-t border-border px-3 py-2.5 first:border-t-0",
        className
      )}
      {...props}
    />
  )
}

export { List, ListRow }
