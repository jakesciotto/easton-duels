import type { MatView, TeamView } from '@shared/types'
import { TeamDot } from '@/components/TeamDot'

function colorFor(teams: TeamView[], teamId: number | null): string {
  return teams.find(t => t.id === teamId)?.color ?? 'red'
}

export function OnDeckStrip({ mats, teams, fallbackCount }: { mats: MatView[]; teams: TeamView[]; fallbackCount: number | null }) {
  return (
    <section aria-label="On deck" className="flex items-center gap-[2vw] pt-[0.4vw] px-[2.4vw] pb-[1.2vw]">
      {fallbackCount !== null ? (
        <span className="font-mono text-[1vw] font-medium tabular text-muted-foreground">Results entered: {fallbackCount}</span>
      ) : (
        <>
          <span className="text-[1vw] font-medium text-muted-foreground">On deck</span>
          {mats.map(m => (
            <span key={m.id} className="flex items-center gap-[0.5vw] text-[1.1vw] text-[#d9d9de]">
              <span className="font-mono text-[0.95vw] font-medium text-faint">Mat {m.number}</span>
              {m.onDeck[0] ? (
                <>
                  <TeamDot color={colorFor(teams, m.onDeck[0].a.teamId)} name={m.onDeck[0].a.name} size="0.7vw" className="gap-[0.5vw]" />
                  <span className="text-[0.95vw] text-[#5e5f6e]">vs</span>
                  <TeamDot color={colorFor(teams, m.onDeck[0].b.teamId)} name={m.onDeck[0].b.name} size="0.7vw" className="gap-[0.5vw]" />
                </>
              ) : (
                <span className="text-faint">None scheduled</span>
              )}
            </span>
          ))}
        </>
      )}
    </section>
  )
}
