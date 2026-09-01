import type { ClockState } from '@shared/types'
import { formatClock } from '@shared/clock'
import { useClock } from '@/lib/useClock'
import { cn } from '@/lib/utils'

const NEAR_EXPIRY_MS = 30_000

// 7.6: one ladder, transition: none, ever. A frozen board reads a plausible time either
// way, so the stale state is the one that is allowed to say so instead of just going quiet.
export function Clock({
  clock,
  serverNow,
  lastSuccessAt = null,
  pollIntervalMs,
  className,
  staleLabelClassName,
}: {
  clock: ClockState | null
  serverNow: string | null
  // Freshness inputs are optional so every existing caller keeps rendering unchanged until
  // it is wired to pass its useSnapshot() lastSuccessAt and derived poll interval.
  lastSuccessAt?: number | null
  pollIntervalMs?: number
  className?: string
  // 7.6: "Not updating Ns" prints at t2 on the desk and b3 on the board -- the caller is the
  // only one who knows which surface it is on.
  staleLabelClassName?: string
}) {
  const { remainingMs, running, stale, ageSec } = useClock(clock, serverNow, lastSuccessAt, pollIntervalMs)
  const expired = clock !== null && remainingMs <= 0
  const nearExpiry = running && !expired && remainingMs <= NEAR_EXPIRY_MS

  const colorClass = stale ? 'text-gray-10'
    : expired ? 'text-fault'
    : nearExpiry ? 'text-white'
    : running ? 'text-gray-11'
    : 'text-gray-10'

  return (
    <>
      <span className={cn('fig fig-4', className, colorClass)}>{formatClock(remainingMs)}</span>
      {stale && ageSec !== null && (
        <span className={cn('t2 text-gray-10', staleLabelClassName)}>Not updating {ageSec}s</span>
      )}
    </>
  )
}
