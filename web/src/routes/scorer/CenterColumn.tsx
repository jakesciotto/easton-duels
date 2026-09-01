import type { MatchView, MatView } from '@shared/types'
import { formatClock } from '@shared/clock'
import { Clock } from '@/components/Clock'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function CenterColumn({ mat, match, serverNow, disabled, flash, onClock, onUndo, onEnd }: {
  mat: MatView; match: MatchView; serverNow: string | null; disabled: boolean; flash: boolean
  onClock: () => void; onUndo: () => void; onEnd: () => void
}) {
  const running = match.clock.startedAt !== null
  const timeUp = !running && match.clock.elapsedMs >= match.clock.lengthMs
  const btn = 'touch h-14 w-full text-lg font-semibold'
  const onDeck = mat.onDeck[0]
  return (
    <div className={cn('flex w-[26%] flex-col items-center justify-between gap-3 border-x border-border bg-background p-3 transition-colors', flash && 'bg-warn/10')}>
      <div className="flex items-baseline justify-center gap-2">
        <span className="text-sm font-semibold tracking-[-0.02em]">Mat {mat.number}</span>
        <span className="label">Match {match.orderIndex + 1}</span>
      </div>
      <Clock clock={match.clock} serverNow={serverNow} className="text-[9vh] font-medium" />
      <div className="font-mono tabular-nums text-xs text-gray-10">of {formatClock(match.clock.lengthMs)}</div>
      <Button type="button" variant={running ? 'secondary' : 'default'} disabled={disabled || timeUp || match.pendingTerminal !== null} onClick={onClock} className={btn}>
        {running ? 'Pause' : 'Start'}
      </Button>
      <Button type="button" variant="secondary" disabled={disabled || match.lastSeq === 0} onClick={onUndo} className={btn}>Undo</Button>
      <Button type="button" variant="secondary" disabled={disabled} onClick={onEnd} className={btn}>End match</Button>
      <div className="text-center text-xs text-gray-10">
        {onDeck ? `Next: ${onDeck.a.name} vs ${onDeck.b.name}` : 'Last match on this mat'}
      </div>
    </div>
  )
}
