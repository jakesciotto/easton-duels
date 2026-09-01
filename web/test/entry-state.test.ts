import { describe, it, expect, beforeEach } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  SAME_PAIR_WINDOW_MS, clearDraft, clockLabel, isRepeatPair, loadDraft, pairKey, saveDraft, saveErrorCopy, teamWins,
  type EntryDraft,
} from '@/routes/event/entry-state'
import type { AthleteRow, MatchRow } from '@/lib/types'

const draft: EntryDraft = {
  entryId: 'e1234567-aaaa', aId: '101', bId: '201', pointsA: '5', pointsB: '2',
  winner: 'a', winType: 'points', editingId: null,
}

const kid = (id: number, teamId: number | null): AthleteRow => ({
  id, eventId: 7, teamId, firstName: 'A', lastName: 'B', age: null, ageSource: null, weightLbs: null, weightSource: null,
  belt: null, gender: null, source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
})
const match = (id: number, over: Partial<MatchRow>): MatchRow => ({
  id, eventId: 7, matId: null, orderIndex: id, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200,
  status: 'pending', winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null, ...over,
})

beforeEach(() => sessionStorage.clear())

describe('entry draft', () => {
  it('round trips a draft and clears it', () => {
    saveDraft(7, draft)
    expect(loadDraft(7)).toEqual(draft)
    clearDraft(7)
    expect(loadDraft(7)).toBeNull()
  })

  it('keeps one draft per event', () => {
    saveDraft(7, draft)
    expect(loadDraft(8)).toBeNull()
  })

  it('ignores a stored value that is not a draft', () => {
    sessionStorage.setItem('duels:entry:7', '{"entryId":"short"}')
    expect(loadDraft(7)).toBeNull()
    sessionStorage.setItem('duels:entry:7', 'not json')
    expect(loadDraft(7)).toBeNull()
  })
})

describe('same pair guard', () => {
  it('keys a pair without regard to side', () => {
    expect(pairKey(200, 100)).toBe(pairKey(100, 200))
  })

  it('holds for a minute and then lets the pair through', () => {
    const now = 1_000_000
    const log = { [pairKey(100, 200)]: now }
    expect(isRepeatPair(log, pairKey(100, 200), now + SAME_PAIR_WINDOW_MS - 1)).toBe(true)
    expect(isRepeatPair(log, pairKey(100, 200), now + SAME_PAIR_WINDOW_MS)).toBe(false)
    expect(isRepeatPair(log, pairKey(100, 201), now)).toBe(false)
  })
})

describe('team wins', () => {
  it('counts only finished matches, by the winner own team', () => {
    const athletes = [kid(100, 1), kid(200, 2), kid(300, null)]
    const wins = teamWins([
      match(1, { status: 'done', winnerAthleteId: 100 }),
      match(2, { status: 'done', winnerAthleteId: 200 }),
      match(3, { status: 'done', winnerAthleteId: 100 }),
      match(4, { status: 'pending', winnerAthleteId: 200 }),
      match(5, { status: 'done', winnerAthleteId: 300 }),
    ], athletes)
    expect(wins.get(1)).toBe(2)
    expect(wins.get(2)).toBe(1)
  })
})

describe('save error copy', () => {
  it('names the gym wifi case and keeps the entry', () => {
    expect(saveErrorCopy(new Error('timeout')).title).toBe('Could not reach the server')
  })

  it('maps the server codes to an instruction', () => {
    expect(saveErrorCopy(new ApiError(429, 'rate_limited', 'too many')).title).toBe('Too many attempts')
    expect(saveErrorCopy(new ApiError(409, 'match_state', 'already done')).body).toMatch(/Live tab/)
    expect(saveErrorCopy(new ApiError(409, 'sequence', 'stale')).title).toMatch(/Another device/)
    expect(saveErrorCopy(new ApiError(422, 'validation', 'winner must be one of the two athletes')).body).toBe('winner must be one of the two athletes')
    expect(saveErrorCopy(new ApiError(500, 'internal', 'boom')).body).toBe('Press Save to try again.')
  })
})

describe('clock label', () => {
  it('reads as a wall clock in five characters', () => {
    expect(clockLabel(new Date(2026, 9, 3, 15, 41))).toBe('3:41')
    expect(clockLabel(new Date(2026, 9, 3, 12, 5))).toBe('12:05')
    expect(clockLabel(new Date(2026, 9, 3, 0, 9))).toBe('12:09')
  })
})
