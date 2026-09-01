import type { CSSProperties } from 'react'
import type { MatView, MatchView, TeamView } from '@shared/types'
import { Clock } from '@/components/Clock'
import { TeamDot } from '@/components/TeamDot'
import { Badge } from '@/components/ui/badge'
import { winTypeLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RecentResult } from './useRecentResults'

function fighterDetail(belt: string | null, weightLbs: number | null): string {
  const parts: string[] = []
  if (belt) parts.push(belt.charAt(0).toUpperCase() + belt.slice(1))
  if (weightLbs != null) parts.push(`${weightLbs} lb`)
  return parts.join(', ')
}

function Fighter({ side, teams }: { side: MatchView['a']; teams: TeamView[] }) {
  const team = teams.find(t => t.id === side.teamId)
  const detail = fighterDetail(side.belt, side.weightLbs)
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-[calc(1vw*var(--scale,1))]">
      <div className="flex min-w-0 items-center gap-[calc(0.7vw*var(--scale,1))]">
        <TeamDot color={team?.color ?? 'red'} size="calc(0.8vw*var(--scale,1))" />
        <b className="truncate text-[calc(1.6vw*var(--scale,1))] font-semibold tracking-[-0.02em]">{side.name}</b>
        {detail && <small className="shrink-0 text-[calc(0.95vw*var(--scale,1))] text-gray-10">{detail}</small>}
      </div>
      <span className="font-mono text-[calc(3vw*var(--scale,1))] leading-none font-medium tabular">{side.score}</span>
    </div>
  )
}

export function MatchBody({ match, teams }: { match: MatchView; teams: TeamView[] }) {
  if (match.status === 'done' && match.result) {
    const winner = match.result.winnerAthleteId === match.a.athleteId ? match.a : match.b
    return (
      <div className="row-[2/4] grid place-items-center text-center">
        <div>
          <b className="block text-[calc(2.4vw*var(--scale,1))] font-semibold tracking-[-0.035em]">{winner.name} wins</b>
          <span className="text-[calc(1.1vw*var(--scale,1))] text-ok">{winTypeLabel(match.result.winType)}</span>
        </div>
      </div>
    )
  }
  return (
    <>
      <Fighter side={match.a} teams={teams} />
      <Fighter side={match.b} teams={teams} />
    </>
  )
}

export function MatTile({ mat, teams, serverNow, recent, large = false }: {
  mat: MatView
  teams: TeamView[]
  serverNow: string | null
  recent: RecentResult | undefined
  large?: boolean
}) {
  const showing = recent?.match ?? mat.current
  const finished = showing?.status === 'done'
  const pending = showing != null && showing.status !== 'done' && showing.pendingTerminal !== null
  return (
    <section
      aria-label={`Mat ${mat.number}`}
      style={{ '--scale': large ? 1.4 : 1 } as CSSProperties}
      className={cn(
        'grid grid-rows-[auto_1fr_1fr_auto] gap-[calc(0.5vw*var(--scale,1))] rounded-[calc(1vw*var(--scale,1))] border bg-card py-[calc(1vw*var(--scale,1))] px-[calc(1.3vw*var(--scale,1))] transition-colors duration-150',
        finished ? 'border-ok/45' : 'border-border',
      )}
    >
      <div className="flex items-baseline gap-[calc(0.8vw*var(--scale,1))]">
        <span className="text-[calc(1.5vw*var(--scale,1))] font-semibold tracking-[-0.02em]">Mat {mat.number}</span>
        {showing && <span className="text-[calc(1vw*var(--scale,1))] text-gray-10">Match {showing.orderIndex + 1}</span>}
        {pending && <Badge variant="warn">Submission pending</Badge>}
        {showing && (
          <Clock
            clock={showing.clock}
            serverNow={serverNow}
            className="ml-auto text-[calc(1.7vw*var(--scale,1))] font-medium"
          />
        )}
      </div>
      {showing
        ? <MatchBody match={showing} teams={teams} />
        : <div className="row-[2/4] grid place-items-center text-[calc(1.4vw*var(--scale,1))] text-gray-10">Waiting for the next match</div>}
      {mat.onDeck[0] && (
        <div className="border-t border-border pt-[calc(0.5vw*var(--scale,1))] text-[calc(1vw*var(--scale,1))] text-gray-10">
          <b className="mr-[calc(0.5vw*var(--scale,1))] font-medium text-muted-foreground">Next</b>
          {mat.onDeck[0].a.name} vs {mat.onDeck[0].b.name}
        </div>
      )}
    </section>
  )
}
