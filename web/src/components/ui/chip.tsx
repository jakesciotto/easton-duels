import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// 7.14: dotless, for data (Badge's leading dot is the status semantic and
// stays reserved for status). A label plus a mono value, or plain children
// for a one-piece value such as a match's "why". Truncated with a title.
function Chip({
  label,
  value,
  children,
  title,
  className,
}: {
  label?: ReactNode
  value?: ReactNode
  children?: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      data-slot="chip"
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-md bg-gray-5 px-2 py-0.5 t3 text-gray-11",
        className
      )}
    >
      {label !== undefined && <span className="text-gray-9">{label}</span>}
      {value !== undefined ? <span className="fig text-gray-11">{value}</span> : children}
    </span>
  )
}

export { Chip }
