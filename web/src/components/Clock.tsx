import type { ClockState } from '@shared/types'
import { formatClock } from '@shared/clock'
import { useClock } from '@/lib/useClock'
import { cn } from '@/lib/utils'

export function Clock({ clock, serverNow, className }: { clock: ClockState | null; serverNow: string | null; className?: string }) {
  const { remainingMs, running } = useClock(clock, serverNow)
  return <span className={cn('tabular font-mono', running && 'text-ok', className)}>{formatClock(remainingMs)}</span>
}
