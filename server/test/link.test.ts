import { describe, it, expect } from 'vitest'
import { linkUpdate, fullName } from '../src/roster/link.js'
import { type RosterCandidateRow } from '../src/db/schema.js'

const cand = (o: Partial<RosterCandidateRow>): RosterCandidateRow => ({
  id: 0, eventId: 0, wlUid: 'w0', firstName: 'Jonas', lastName: 'Blake', belt: 'yellow',
  wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4, age: 10, weightLbs: 70, gender: 'M', promotedAt: '2026-03-14', ...o,
})

describe('fullName', () => {
  it('joins first and last with a space', () => {
    expect(fullName({ firstName: 'Ana', lastName: 'Reyes' })).toBe('Ana Reyes')
  })
})

describe('linkUpdate', () => {
  it('writes every field on the first link', () => {
    const update = linkUpdate({ wlUid: null, ageSource: null, weightSource: null }, cand({}))
    expect(update).toEqual({
      wlUid: 'w0', wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4,
      belt: 'yellow', promotedAt: '2026-03-14', gender: 'M',
      age: 10, ageSource: 'leaderboard', weightLbs: 70, weightSource: 'leaderboard',
    })
  })

  it('dates the belt it writes, and dates nothing when it writes no belt', () => {
    const undated = linkUpdate({ wlUid: null, ageSource: null, weightSource: null }, cand({ promotedAt: null }))
    expect(undated).toMatchObject({ belt: 'yellow', promotedAt: null })
    const beltless = linkUpdate({ wlUid: null, ageSource: null, weightSource: null }, cand({ belt: null }))
    expect(beltless).not.toHaveProperty('promotedAt')
  })

  it('never overwrites belt or gender with a null candidate value', () => {
    const update = linkUpdate(
      { wlUid: null, ageSource: null, weightSource: null },
      cand({ belt: null, gender: null, age: null, weightLbs: null }),
    )
    expect(update).toEqual({ wlUid: 'w0', wlLocation: 'North', leaderboardId: 'jonas-blake', erp: 4.4 })
  })

  it('keeps a manual age or weight on a refresh, not on the first link', () => {
    const refresh = linkUpdate({ wlUid: 'w0', ageSource: 'manual', weightSource: 'manual' }, cand({ age: 11, weightLbs: 75 }))
    expect(refresh.age).toBeUndefined()
    expect(refresh.weightLbs).toBeUndefined()
    const first = linkUpdate({ wlUid: null, ageSource: 'manual', weightSource: 'manual' }, cand({ age: 11, weightLbs: 75 }))
    expect(first).toMatchObject({ age: 11, ageSource: 'leaderboard', weightLbs: 75, weightSource: 'leaderboard' })
  })
})
