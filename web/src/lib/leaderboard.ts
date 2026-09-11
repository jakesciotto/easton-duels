import type { LeaderboardRow } from './types'

export interface RankableTeam { id: number; wins: number; points: number; position: number }

/**
 * Spec 5's order: wins, then points, then the position the team was created at, which
 * never ties. Teams level on wins and points share a rank and the ranks they used up are
 * skipped, so a table reads 1, 1, 3 rather than 1, 1, 2.
 */
export function rankTeams(teams: RankableTeam[]): LeaderboardRow[] {
  const sorted = [...teams].sort((x, y) => y.wins - x.wins || y.points - x.points || x.position - y.position)
  const rows: LeaderboardRow[] = []
  for (const [i, team] of sorted.entries()) {
    const above = rows[i - 1]
    const tied = above !== undefined && above.wins === team.wins && above.points === team.points
    rows.push({ teamId: team.id, rank: tied ? above.rank : i + 1, wins: team.wins, points: team.points })
  }
  return rows
}
