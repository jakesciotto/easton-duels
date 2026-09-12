import type { LeaderboardRow, TeamView } from '@shared/types'
import { Skeleton } from '@/components/ui/skeleton'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Fig } from './MatRow'

/**
 * One standing. The rank numeral sits on the mat numeral's own track, the team colour
 * is a full height edge at the second half of the leading indent, so it costs no column
 * exactly as a mat row's edge does, then the name, the wins figure and the points.
 *
 * No three letter plate and no repeated "Wins": at eight rows both are noise, and a
 * plate would take the name track. "pts" stays on the small figure so the pair of
 * numbers cannot be misread as one.
 */
function Standing({ team, row }: { team: TeamView; row: LeaderboardRow }) {
  return (
    <div style={teamStyle(team.color)} className={cn('lb-row font-mono', row.rank === 1 ? 'lb-lead' : null)}>
      <span aria-hidden className="lb-edge" />
      <span className="lb-rank">{row.rank}</span>
      <span className="lb-name font-sans">{team.name}</span>
      <Fig className="lb-wins" value={row.wins} />
      <span className="lb-pts font-sans">
        <span className="lb-pts-n font-mono">{row.points}</span>
        <span> pts</span>
      </span>
    </div>
  )
}

/**
 * 7.1: one hero for every team count, the ranked leaderboard. The order and the ranks
 * are the server's, off the snapshot, so the television, the Live tab and the console
 * cannot answer "who is winning" three ways. Tied teams share a numeral and every one
 * of them takes the lead tone; nothing else marks a tie, because a highlight would read
 * as a winner.
 */
export function Hero({ teams, leaderboard }: { teams: TeamView[]; leaderboard: LeaderboardRow[] }) {
  const byId = new Map(teams.map(t => [t.id, t]))
  return (
    <section aria-label="Scoreboard" className="b-lb">
      {leaderboard.map(row => {
        const team = byId.get(row.teamId)
        return team === undefined ? null : <Standing key={row.teamId} team={team} row={row} />
      })}
    </section>
  )
}

/**
 * The board is the first thing the room sees on the television, so the cold start is a
 * real composition rather than an absence: the rows, their edges and their tracks are
 * already in their final positions and only the values arrive.
 *
 * 6.15 is exact about the count: ONLY the wins numerals are Skeletons. There is no
 * snapshot yet to say how many teams the event holds, so the cold hero draws the two an
 * event holds at its minimum, and their edges, names and numerals are empty boxes rather
 * than skeletons: their shape is known, their content is not.
 */
export function HeroSkeleton() {
  return (
    <section aria-label="Scoreboard" className="b-lb">
      {[0, 1].map(i => (
        <div key={i} className="lb-row font-mono">
          <span aria-hidden className="lb-edge" />
          <span className="lb-rank" />
          <span className="lb-name font-sans" />
          <Skeleton className="lb-wins b-skel-wins" />
          <span className="lb-pts font-sans">
            <span className="lb-pts-n font-mono" />
            <span> pts</span>
          </span>
        </div>
      ))}
    </section>
  )
}
