import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// 7.10: a row inside the field at the field's own rung, never a bordered box
// and never a skeleton. message always carries a verb; action is an inline
// ghost button (or link styled as one) at the right of the same row.
//
// The rung is a floor rather than a fixed height, because these sit in columns as
// narrow as 350px: at the fixed height the message wrapped out of the box and left
// its action stranded at the far edge, reading as two unrelated things.
//
// It also takes the sans face back. A dense field pins the mono face so its numeric
// tracks resolve ch correctly, and an empty state is a sentence rather than a figure.
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
      className={cn("flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5 font-sans t2 text-gray-10", className)}
    >
      <span>{message}</span>
      {action}
    </div>
  )
}

export { EmptyState }
