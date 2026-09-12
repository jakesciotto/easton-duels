import { describe, it, expect } from 'vitest'
import { rankTeams } from '../src/shared/leaderboard.js'

const team = (id: number, wins: number, points: number, position: number) => ({ id, wins, points, position })

describe('rankTeams', () => {
  it('orders by wins first, whatever the points say', () => {
    const rows = rankTeams([team(1, 2, 40, 0), team(2, 5, 3, 1), team(3, 3, 90, 2)])
    expect(rows.map(r => r.teamId)).toEqual([2, 3, 1])
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3])
  })

  it('breaks a wins tie on points', () => {
    const rows = rankTeams([team(1, 4, 11, 0), team(2, 4, 19, 1)])
    expect(rows.map(r => r.teamId)).toEqual([2, 1])
    expect(rows.map(r => r.rank)).toEqual([1, 2])
  })

  it('takes position as the last key, which never ties', () => {
    const rows = rankTeams([team(3, 1, 6, 2), team(1, 1, 6, 0), team(2, 1, 6, 1)])
    expect(rows.map(r => r.teamId)).toEqual([1, 2, 3])
  })

  it('shares a rank between teams level on wins and points, and skips the ranks they used', () => {
    const rows = rankTeams([team(1, 3, 8, 0), team(2, 3, 8, 1), team(3, 1, 20, 2)])
    expect(rows.map(r => r.rank)).toEqual([1, 1, 3])
  })

  it('shares the rank further down the table too', () => {
    const rows = rankTeams([team(1, 9, 30, 0), team(2, 2, 5, 1), team(3, 2, 5, 2), team(4, 0, 0, 3)])
    expect(rows.map(r => r.rank)).toEqual([1, 2, 2, 4])
  })

  it('carries the wins and points of each team back out', () => {
    expect(rankTeams([team(7, 4, 21, 0)])).toEqual([{ teamId: 7, rank: 1, wins: 4, points: 21 }])
  })

  it('answers an event with no teams', () => {
    expect(rankTeams([])).toEqual([])
  })

  it('leaves the list it was handed alone', () => {
    const teams = [team(1, 0, 0, 0), team(2, 5, 5, 1)]
    rankTeams(teams)
    expect(teams.map(t => t.id)).toEqual([1, 2])
  })
})
