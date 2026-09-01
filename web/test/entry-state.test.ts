import { describe, it, expect, beforeEach } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  SAME_PAIR_WINDOW_MS, clearDraft, clockLabel, draftKey, isRepeatPair, ledgerTime, loadDraft, pairKey, restoreDraft,
  saveDraft, saveErrorCopy, teamWins,
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

  // One slot per event destroyed an unsent new entry the moment any correction
  // was saved or cancelled, because both wrote and cleared the same key.
  it('gives a new entry and a correction separate slots', () => {
    const correction: EntryDraft = { ...draft, entryId: 'e7654321-bbbb', editingId: 4 }
    saveDraft(7, draft)
    saveDraft(7, correction)
    expect(draftKey(7, null)).not.toBe(draftKey(7, 4))
    expect(loadDraft(7)).toEqual(draft)
    expect(loadDraft(7, 4)).toEqual(correction)

    clearDraft(7, 4)
    expect(loadDraft(7, 4)).toBeNull()
    expect(loadDraft(7)).toEqual(draft)
  })

  it('keeps two corrections of different matches apart', () => {
    saveDraft(7, { ...draft, editingId: 4 })
    saveDraft(7, { ...draft, entryId: 'e7654321-cccc', editingId: 5 })
    clearDraft(7, 5)
    expect(loadDraft(7, 4)).toMatchObject({ editingId: 4 })
    expect(loadDraft(7, 5)).toBeNull()
  })

  it('refuses a payload whose intent disagrees with its slot', () => {
    sessionStorage.setItem(draftKey(7, null), JSON.stringify({ ...draft, editingId: 4 }))
    expect(loadDraft(7)).toBeNull()
  })

  it('restores the unsent new entry first and a stranded correction otherwise', () => {
    saveDraft(7, { ...draft, entryId: 'e7654321-dddd', editingId: 9 })
    expect(restoreDraft(7)).toMatchObject({ editingId: 9 })
    saveDraft(7, draft)
    expect(restoreDraft(7)).toEqual(draft)
    expect(restoreDraft(8)).toBeNull()
  })

  it('restores the lowest match when several corrections are stranded', () => {
    saveDraft(7, { ...draft, entryId: 'e7654321-ffff', editingId: 12 })
    saveDraft(7, { ...draft, entryId: 'e7654321-eeee', editingId: 3 })
    expect(restoreDraft(7)).toMatchObject({ editingId: 3 })
  })
})

describe('ledger time', () => {
  // The At column was fed only by this browser session, so a reload or a second
  // desk device rendered every row blank for the rest of the event.
  it('prefers the server record and falls back to the in session stamp', () => {
    const ended = new Date(2026, 9, 3, 15, 41).toISOString()
    const saved = new Date(2026, 9, 3, 9, 5).getTime()
    expect(ledgerTime(ended, saved)).toEqual(new Date(ended))
    expect(ledgerTime(null, saved)).toEqual(new Date(saved))
    expect(ledgerTime(undefined, saved)).toEqual(new Date(saved))
    expect(ledgerTime(null, undefined)).toBeNull()
    expect(ledgerTime('not a date', undefined)).toBeNull()
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
