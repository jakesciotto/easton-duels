import type { MatchSide, RulesetView, TeamView } from '@shared/types'
import { beltLabel, teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function ScoreSide({ side, team, ruleset, disabled, pendingKey, onTap, onTerminal }: {
  side: MatchSide; team: TeamView | undefined; ruleset: RulesetView | null; disabled: boolean; pendingKey: string | null
  onTap: (actionKey: string) => void; onTerminal: (actionKey: string) => void
}) {
  const color = team?.color ?? 'red'
  const meta = [team?.name, beltLabel(side.belt), side.weightLbs !== null ? `${side.weightLbs} lb` : null].filter(Boolean).join(', ')
  return (
    <section
      aria-label={side.name}
      style={{ ...teamStyle(color), background: 'color-mix(in oklab, var(--team) 8%, #000)' }}
      className="relative flex flex-1 flex-col gap-3 p-4 before:absolute before:top-0 before:left-4 before:right-4 before:h-[0.35vw] before:rounded-b-sm before:bg-[var(--team)] before:content-['']"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tracking-[-0.035em]">{side.name}</span>
        <span className="shrink-0 text-xs text-faint">{meta}</span>
      </div>
      <div className="grid flex-1 place-items-center text-[20vh] leading-none font-mono font-medium tabular text-foreground">{side.score}</div>
      <div className="grid grid-cols-3 gap-2">
        {(ruleset?.actions ?? []).map(a => (
          <Button
            key={a.key}
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => onTap(a.key)}
            className={cn('touch h-14 flex-col gap-0.5 whitespace-normal text-base', a.points < 0 && 'border border-warn/40')}
          >
            {a.label}
            <span className="text-xs font-normal text-faint">{a.points >= 0 ? '+' : ''}{a.points}</span>
          </Button>
        ))}
        {(ruleset?.terminals ?? []).map(t => (
          <Button
            key={t.key}
            type="button"
            variant="secondary"
            disabled={disabled || pendingKey !== null}
            onClick={() => onTerminal(t.key)}
            className="touch h-14 border border-dashed border-input text-base"
          >
            {t.label}
          </Button>
        ))}
      </div>
    </section>
  )
}
