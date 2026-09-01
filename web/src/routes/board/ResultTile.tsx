import type { CSSProperties } from 'react'
import type { MatchView, TeamView } from '@shared/types'
import { MatchBody } from './MatTile'

export function ResultTile({ match, teams, large = false }: { match: MatchView; teams: TeamView[]; large?: boolean }) {
  return (
    <section
      aria-label={`Result ${match.orderIndex + 1}`}
      style={{ '--scale': large ? 1.4 : 1 } as CSSProperties}
      className="grid grid-rows-[auto_1fr_1fr] gap-[calc(0.5vw*var(--scale,1))] rounded-[calc(1vw*var(--scale,1))] border border-ok/45 bg-card py-[calc(1vw*var(--scale,1))] px-[calc(1.3vw*var(--scale,1))]"
    >
      <div className="text-[calc(1vw*var(--scale,1))] text-gray-10">Match {match.orderIndex + 1}</div>
      <MatchBody match={match} teams={teams} />
    </section>
  )
}
