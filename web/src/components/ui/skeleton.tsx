import * as React from "react"

import { cn } from "@/lib/utils"

// 7.11: only for async data filling a known layout, sized to the final
// content. No default size and no shimmer: the deny list (4.2) bans a
// repeating shimmer, and a caller that forgets to size this renders nothing
// useful rather than a guessed placeholder.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-sm bg-gray-6", className)}
      {...props}
    />
  )
}

export { Skeleton }
