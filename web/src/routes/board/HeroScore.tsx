import type { TeamView } from '@shared/types'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'

function Half({ team, align }: { team: TeamView; align: 'left' | 'right' }) {
  return (
    <div
      style={teamStyle(team.color)}
      className={cn(
        "relative grid content-center px-[4vw] py-[2.6vw] before:absolute before:top-0 before:left-[4vw] before:right-[4vw] before:h-[0.35vw] before:rounded-b-[0.2vw] before:bg-[var(--team)] before:content-['']",
        align === 'left' ? 'border-r border-border' : 'text-right',
      )}
    >
      <div className="font-mono text-[12vw] leading-[0.95] font-medium tracking-[-0.04em] tabular text-foreground">{team.wins}</div>
      <div className="mt-[0.4vw] text-[3vw] font-semibold tracking-[-0.035em] text-[var(--team)]">{team.name}</div>
      <div className="mt-[0.3vw] font-mono text-[1.4vw] tabular text-muted-foreground">{team.points} pts</div>
    </div>
  )
}

export function HeroScore({ teams }: { teams: TeamView[] }) {
  const [a, b] = teams
  return (
    <section aria-label="Scoreboard" className="grid grid-cols-2 border-b border-border">
      <Half team={a} align="left" />
      <Half team={b} align="right" />
    </section>
  )
}
