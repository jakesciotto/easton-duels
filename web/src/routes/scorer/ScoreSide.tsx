import type { MatchSide, RulesetView, TeamView } from '@shared/types'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TeamPlate } from '@/components/TeamPlate'
import { signed } from './actions'

// 6.16: fixed 3 x 3, and a ruleset with six actions leaves the rest EMPTY rather than
// re-laying out. A thumb learns a position and the position never moves. A ruleset with
// more than nine actions grows downwards in whole rows, so the first nine never move either.
const GRID_COLUMNS = 3
const GRID_CELLS = 9

export function ScoreSide({ side, team, ruleset, edge, lead, expired, refusal, onTap, onTerminal }: {
  side: MatchSide
  team: TeamView | undefined
  ruleset: RulesetView | null
  edge: 'left' | 'right'
  lead: boolean
  expired: boolean
  /** Non-null disables the whole half and prints itself. 6.16, refuse rather than reject. */
  refusal: string | null
  onTap: (actionKey: string) => void
  onTerminal: (actionKey: string) => void
}) {
  const color = team?.color ?? 'red'
  const actions = ruleset?.actions ?? []
  const terminals = ruleset?.terminals ?? []
  const cells = Math.max(GRID_CELLS, Math.ceil(actions.length / GRID_COLUMNS) * GRID_COLUMNS)
  const disabled = refusal !== null

  return (
    <section
      aria-label={side.name}
      style={teamStyle(color)}
      className={cn('relative flex min-w-0 flex-col bg-background p-8', edge === 'right' && 'items-end text-right')}
    >
      {/* 6.16: an 8px full chroma bar identifies the half, at a fixed size, because a
          finger and an eye are physical constants. The deleted 8 percent tint measured
          1.00:1 and never did this job on any iPad in any room. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-2 bg-[var(--team)]" />
      <span aria-hidden className={cn('absolute inset-y-0 w-2 bg-[var(--team)]', edge === 'left' ? 'left-0' : 'right-0')} />

      <TeamPlate color={color} name={team?.name ?? 'Unassigned'} size="scorer" />
      <div className="mt-3 max-w-full truncate t5 text-gray-12">{side.name}</div>
      <div className={cn('mt-1 flex items-center gap-3', edge === 'right' && 'flex-row-reverse')}>
        <span aria-hidden style={teamStyle(color)} className="team-dot size-4 shrink-0 rounded-full" />
        <span
          className={cn(
            'fig fig-2 text-[length:max(18vh,140px)] leading-none tracking-[-0.02em]',
            lead ? 'text-fig-lead' : 'text-fig-trail',
          )}
        >
          {side.score}
        </span>
      </div>

      <div className="mt-auto w-full">
        {refusal && <p className="mb-4 t2 text-gray-10">{refusal}</p>}
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: cells }, (_, i) => {
            const a = actions[i]
            if (!a) return <div key={`empty-${i}`} aria-hidden className="h-16" />
            return (
              <Button
                key={a.key}
                type="button"
                size="mat"
                variant="secondary"
                disabled={disabled}
                onClick={() => onTap(a.key)}
                // The two halves carry the same ruleset, so the visible label alone gives a
                // rotor, a screen reader and Voice Control two identical targets, one of
                // which awards the point to the wrong competitor. The section label is a
                // landmark and does not reach a button list.
                aria-label={`${a.label} ${signed(a.points)} for ${side.name}`}
                className="touch h-full min-h-16 flex-col gap-0.5 px-2 whitespace-normal"
              >
                <span className="t2">{a.label}</span>
                <span className="fig t1 text-gray-10">{signed(a.points)}</span>
              </Button>
            )
          })}
        </div>

        {/* 6.16, the moat: 32px of empty space and a 1px rule, never a dashed border,
            which is not a distinction under gym lighting. */}
        <div aria-hidden className="h-8" />
        <div aria-hidden className="h-px bg-gray-7" />
        <div className="mt-4 grid grid-cols-2 gap-4">
          {terminals.map(t => (
            <Button
              key={t.key}
              type="button"
              size="mat"
              variant="ghost"
              disabled={disabled}
              onClick={() => onTerminal(t.key)}
              // A terminal ends the match and awards a team point, so two identically named
              // targets is the most expensive version of the ambiguity above.
              aria-label={`${t.label} for ${side.name}`}
              className="touch h-[104px] w-full border border-gray-7"
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 6.16: expiry is a frame, not a wash, and area is what makes an alarm visible in a
          lit room. It is an overlay rather than a border so the action grid underneath
          keeps every cell exactly where the thumb left it. */}
      {expired && <span aria-hidden className="pointer-events-none absolute inset-0 border-[32px] border-fault" />}
    </section>
  )
}
