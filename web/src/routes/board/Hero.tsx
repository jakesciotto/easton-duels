import { TEAM_COLOR_LABELS, teamCode, type TeamColor, type TeamView } from '@shared/types'
import { Skeleton } from '@/components/ui/skeleton'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Fig, figTone } from './MatRow'

function Half({ team, side, tone, quiet }: { team: TeamView; side: 'a' | 'b'; tone: string; quiet: boolean }) {
  return (
    <div style={teamStyle(team.color)} className={cn('b-half', side === 'b' ? 'b-half-b' : null)}>
      <div className={cn('b-bar', quiet ? 'b-bar-quiet' : null)} />
      <div className="b-plate-row">
        <span aria-hidden className="b-code font-mono">{teamCode(team.name)}</span>
        <span className="b-team-name font-sans">{team.name}</span>
        <span className="sr-only">{TEAM_COLOR_LABELS[team.color as TeamColor]}</span>
      </div>
      <div className="b-score-row">
        <Fig className={cn('b-wins font-mono', tone)} value={team.wins} />
        <span className="b-labels font-sans">
          <span>Wins</span>
          <span className="font-mono">
            {team.points}
            <span className="font-sans"> pts</span>
          </span>
        </span>
      </div>
    </div>
  )
}

/**
 * Team A is permanently left. Half B mirrors it, so the two plates sit at the outer
 * edges and the two numerals face each other across the centre: the figures a person
 * compares are always the ones closest together.
 *
 * The labels stack beside the numeral rather than flanking it. Flanking put three
 * objects on one baseline row, which is 1245px of content in an 825px half.
 */
export function Hero({ teams, winnerId }: { teams: TeamView[]; winnerId?: number | null }) {
  const [a, b] = teams
  return (
    <section aria-label="Scoreboard" className="b-hero">
      <Half team={a} side="a" tone={figTone(a.wins, b.wins)} quiet={winnerId != null && winnerId !== a.id} />
      <Half team={b} side="b" tone={figTone(b.wins, a.wins)} quiet={winnerId != null && winnerId !== b.id} />
    </section>
  )
}

/**
 * The board is the first thing the room sees on the television, so the cold start is a
 * real composition rather than an absence: the stage, both bars, both plates and both
 * names are already in their final positions and only the values arrive.
 *
 * 6.15 is exact about the count: ONLY the two wins numerals are Skeletons, at the b1
 * 2ch slot width. The bar, the plate and the name hold empty boxes, because there is no
 * snapshot yet to say what colour or what name they take, and skeletoning them would
 * promise data for slots whose shape is already known.
 */
export function HeroSkeleton() {
  return (
    <section aria-label="Scoreboard" className="b-hero">
      {(['a', 'b'] as const).map(side => (
        <div key={side} className={cn('b-half', side === 'b' ? 'b-half-b' : null)}>
          <div className="b-bar" />
          <div className="b-plate-row">
            <span aria-hidden className="b-code b-cold-code" />
            <span className="b-team-name font-sans" />
          </div>
          <div className="b-score-row">
            <Skeleton className="b-skel-wins font-mono" />
            <span className="b-labels font-sans">
              <span>Wins</span>
              <span>
                <span className="b-cold-pts font-mono" />
                <span> pts</span>
              </span>
            </span>
          </div>
        </div>
      ))}
    </section>
  )
}
