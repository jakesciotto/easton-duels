import type { TeamView } from '@shared/types'
import { cn } from '@/lib/utils'
import { Fig } from './MatRow'

function Line({ value, label, big = false }: { value: number; label: string; big?: boolean }) {
  return (
    <div className="b-sum-line">
      <Fig className={cn('b-sum-fig font-mono', big ? 'b-sum-big' : 'b-sum-small')} value={value} />
      <span className="b-sum-label font-sans">{label}</span>
    </div>
  )
}

function SummaryHalf({ team, matches, side }: { team: TeamView; matches: number; side: 'a' | 'b' }) {
  return (
    <div className={cn('b-sum-half', side === 'b' ? 'b-sum-half-b' : null)}>
      <Line value={team.wins} label="Wins" big />
      <Line value={team.points} label="Points" />
      <Line value={matches} label="Matches" />
    </div>
  )
}

export function DoneBand({ teams, matches }: { teams: TeamView[]; matches: number }) {
  const [a, b] = teams
  return (
    <section aria-label="Final" className="b-summary">
      <SummaryHalf team={a} matches={matches} side="a" />
      <SummaryHalf team={b} matches={matches} side="b" />
    </section>
  )
}

/** Wins first, then points as the tie break, matching how the event is scored. */
export function winningTeam(teams: TeamView[]): TeamView | null {
  const [a, b] = teams
  if (!a || !b) return null
  if (a.wins !== b.wins) return a.wins > b.wins ? a : b
  if (a.points !== b.points) return a.points > b.points ? a : b
  return null
}
