import * as React from "react"

import { cn } from "@/lib/utils"

const SHOW_DELAY_MS = 150
const MIN_VISIBLE_MS = 400

// 7.11: a spinner is for one in-flight action, gated by a 150ms show delay
// and a 400ms minimum visible time so a fast mutation never strobes against
// a 1000ms poll. show tracks the action; the component owns its own
// mount/unmount timing rather than trusting the caller to hold it open.
function Spinner({
  show,
  className,
  ...props
}: React.ComponentProps<"svg"> & { show: boolean }) {
  const [visible, setVisible] = React.useState(false)
  const shownAtRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (show) {
      const t = window.setTimeout(() => {
        shownAtRef.current = Date.now()
        setVisible(true)
      }, SHOW_DELAY_MS)
      return () => window.clearTimeout(t)
    }
    if (!visible) return
    const elapsed = shownAtRef.current ? Date.now() - shownAtRef.current : MIN_VISIBLE_MS
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed)
    const t = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  if (!visible) return null

  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-4 animate-spin text-gray-10", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export { Spinner }
