import { describe, it, expect, beforeEach } from 'vitest'
import { ApiError } from '@/lib/api'
import { CERTIFIED_REFUSAL_BODY, CERTIFIED_REFUSAL_TITLE } from '@/lib/eventMode'
import {
  SAME_PAIR_WINDOW_MS, clearDraft, clockLabel, draftKey, isRepeatPair, ledgerTime, loadDraft, pairKey, restoreDraft,
  DRAFT_VERSION, RETRYING_LINE, retriesItself, saveDraft, saveErrorCopy, seedPairLog, serverRefused, teamWins,
  type EntryDraft,
} from '@/routes/event/entry-state'
import type { AthleteRow, MatchRow } from '@/lib/types'

const draft: EntryDraft = {
  v: DRAFT_VERSION, entryId: 'e1234567-aaaa', aId: '101', bId: '201', pointsA: '5', pointsB: '2',
  winner: 'a', winType: 'points', editingId: null, reason: '',
}

const kid = (id: number, teamId: number | null): AthleteRow => ({
  id, eventId: 7, teamId, firstName: 'A', lastName: 'B', age: null, ageSource: null, weightLbs: null, weightSource: null,
  belt: null, gender: null, source: 'manual', wlUid: null, wlLocation: null, leaderboardId: null, erp: null,
  promotedAt: null, syncedAt: null, syncChanges: null, suggestedWlUid: null, suggestedScore: null, dismissedWlUids: [],
})
const match = (id: number, over: Partial<MatchRow>): MatchRow => ({
  id, eventId: 7, matId: null, orderIndex: id, rulesetId: 1, lengthSec: 300, athleteAId: 100, athleteBId: 200,
  status: 'pending', winnerAthleteId: null, winType: null, pointsA: 0, pointsB: 0, clockElapsedMs: 0, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 0, why: null, source: 'designed', ...over,
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

  /**
   * The parked item's migration. A draft is an unsent result, and losing one is the
   * failure the whole mechanism exists to prevent, so a payload written by a build that
   * predates the correction reason restores with an empty one rather than being thrown
   * away with the tab's only copy of a result nobody typed twice.
   */
  it('restores a draft written before the reason field existed', () => {
    sessionStorage.setItem(draftKey(7, 4), JSON.stringify({
      entryId: 'e1234567-aaaa', aId: '101', bId: '201', pointsA: '5', pointsB: '2',
      winner: 'a', winType: 'points', editingId: 4,
    }))
    expect(loadDraft(7, 4)).toEqual({ ...draft, editingId: 4, reason: '', v: DRAFT_VERSION })
  })

  it('stamps the current version on every write and bounds a restored reason', () => {
    saveDraft(7, { ...draft, reason: 'scoreboard was a bout behind' })
    expect(loadDraft(7)?.v).toBe(DRAFT_VERSION)
    expect(loadDraft(7)?.reason).toBe('scoreboard was a bout behind')
    sessionStorage.setItem(draftKey(7, null), JSON.stringify({ ...draft, reason: 'x'.repeat(400) }))
    expect(loadDraft(7)?.reason).toHaveLength(120)
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
  it('names the gym wifi case, keeps the entry, and states the retry that now runs', () => {
    expect(saveErrorCopy(new Error('timeout')).title).toBe('Could not reach the server')
    expect(saveErrorCopy(new Error('timeout')).body).toContain(RETRYING_LINE)
  })

  /**
   * G28 / 7.12: the automatic retry belongs to the unreachable server and to the eight
   * second watchdog, and to nothing else. Everything the server answered would only be
   * answered the same way five seconds later.
   */
  it('retries only what the server never answered', () => {
    expect(retriesItself(new Error('timeout'))).toBe(true)
    expect(retriesItself(new TypeError('Failed to fetch'))).toBe(true)
    expect(retriesItself(new ApiError(429, 'rate_limited', 'too many'))).toBe(false)
    expect(retriesItself(new ApiError(500, 'internal', 'boom'))).toBe(false)
    expect(retriesItself(new ApiError(422, 'validation', 'no'))).toBe(false)
  })

  it('maps the server codes to an instruction', () => {
    expect(saveErrorCopy(new ApiError(429, 'rate_limited', 'too many')).title).toBe('Too many attempts')
    expect(saveErrorCopy(new ApiError(409, 'match_state', 'already done')).body).toMatch(/Live tab/)
    // A certified event refuses even the correction a finished one still takes, so the
    // two match_state sentences must not collapse into one.
    expect(saveErrorCopy(new ApiError(409, 'match_state', 'event is certified')).title).toBe(CERTIFIED_REFUSAL_TITLE)
    expect(saveErrorCopy(new ApiError(409, 'match_state', 'event is certified')).body).toBe(CERTIFIED_REFUSAL_BODY)
    expect(saveErrorCopy(new ApiError(409, 'match_state', 'event is done')).title).toBe('This event is finished')
    expect(saveErrorCopy(new ApiError(409, 'sequence', 'stale')).title).toMatch(/Another device/)
    expect(saveErrorCopy(new ApiError(422, 'validation', 'winner must be one of the two athletes')).body).toBe('winner must be one of the two athletes')
    expect(saveErrorCopy(new ApiError(500, 'internal', 'boom')).body).toBe('Press Save to try again.')
  })
})

describe('serverRefused', () => {
  it('is true only where the server said it stored nothing', () => {
    expect(serverRefused(new ApiError(422, 'validation', 'winner must be one of the two'))).toBe(true)
    expect(serverRefused(new ApiError(404, 'not_found', 'gone'))).toBe(true)
    expect(serverRefused(new ApiError(409, 'match_state', 'already done'))).toBe(true)
  })

  it('is false wherever the write is in doubt', () => {
    expect(serverRefused(new Error('timeout'))).toBe(false)
    expect(serverRefused(new ApiError(500, 'internal', 'boom'))).toBe(false)
    expect(serverRefused(new ApiError(429, 'rate_limited', 'too many'))).toBe(false)
    expect(serverRefused(new ApiError(408, 'timeout', 'too slow'))).toBe(false)
  })
})

describe('seedPairLog', () => {
  it('reads the last stored time of every settled pair, in either athlete order', () => {
    const log = seedPairLog([
      match(1, { status: 'done', athleteAId: 100, athleteBId: 200, endedAt: '2026-10-03T16:00:00.000Z' }),
      match(2, { status: 'done', athleteAId: 200, athleteBId: 100, endedAt: '2026-10-03T16:05:00.000Z' }),
      match(3, { status: 'pending', athleteAId: 101, athleteBId: 201, endedAt: '2026-10-03T16:10:00.000Z' }),
      match(4, { status: 'done', athleteAId: 102, athleteBId: 202, endedAt: null }),
      match(5, { status: 'done', athleteAId: 103, athleteBId: 203, endedAt: 'not a time' }),
    ])
    expect(log).toEqual({ '100-200': Date.parse('2026-10-03T16:05:00.000Z') })
  })

  it('is what the repeat guard reads after a reload', () => {
    const now = Date.now()
    const log = seedPairLog([match(1, { status: 'done', endedAt: new Date(now - 1_000).toISOString() })])
    expect(isRepeatPair(log, pairKey(200, 100), now)).toBe(true)
    expect(isRepeatPair(log, pairKey(200, 100), now + SAME_PAIR_WINDOW_MS)).toBe(false)
  })
})

describe('clock label', () => {
  it('reads as a wall clock in five characters', () => {
    expect(clockLabel(new Date(2026, 9, 3, 15, 41))).toBe('3:41')
    expect(clockLabel(new Date(2026, 9, 3, 12, 5))).toBe('12:05')
    expect(clockLabel(new Date(2026, 9, 3, 0, 9))).toBe('12:09')
  })
})
