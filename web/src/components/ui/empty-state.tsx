import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// 7.10: a row inside the field at the field's own rung, never a bordered box
// and never a skeleton. message always carries a verb; action is an inline
// ghost button (or link styled as one) at the right of the same row.
function EmptyState({
  message,
  action,
  className,
}: {
  message: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex h-10 items-center justify-between gap-3 px-3 t2 text-gray-10", className)}
    >
      <span>{message}</span>
      {action}
    </div>
  )
}

export { EmptyState }
