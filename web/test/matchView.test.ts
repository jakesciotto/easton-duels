import { describe, it, expect } from 'vitest'
import { matchViewOf } from '@/lib/matchView'
import type { EventDetail, MatchRow } from '@/lib/types'
import { sampleMatch, sampleSnapshot } from './fakes'

const row: MatchRow = {
  id: 10, eventId: 1, matId: 1, orderIndex: 3, rulesetId: 1, lengthSec: 300,
  athleteAId: 100, athleteBId: 200, status: 'done', winnerAthleteId: 200, winType: 'submission',
  pointsA: 4, pointsB: 1, clockElapsedMs: 12_000, clockStartedAt: null,
  pendingTerminalAthleteId: null, pendingTerminalKey: null, lastSeq: 6, why: null, source: 'designed',
  endedAt: '2026-10-03T15:41:00.000Z',
}

const detail = {
  athletes: [
    { id: 100, firstName: 'Mateo', lastName: 'Rivera', teamId: 1, belt: 'grey', weightLbs: 62 },
    { id: 200, firstName: 'Olivia', lastName: 'Kim', teamId: 2, belt: 'grey-white', weightLbs: 60 },
  ],
} as unknown as EventDetail

describe('matchViewOf', () => {
  it('prefers the snapshot, which carries the live score and the served endedAt', () => {
    const live = sampleMatch({ id: 10, status: 'done', endedAt: '2026-10-03T16:00:00.000Z' })
    const view = matchViewOf(row, detail, sampleSnapshot({ matches: [live] }))
    expect(view).toBe(live)
  })

  it('builds the view from the row and the roster before the first snapshot lands', () => {
    const view = matchViewOf(row, detail, null)
    expect(view.a).toMatchObject({ athleteId: 100, name: 'Mateo Rivera', teamId: 1, score: 4 })
    expect(view.b).toMatchObject({ athleteId: 200, name: 'Olivia Kim', teamId: 2, score: 1 })
    expect(view.result).toEqual({ winnerAthleteId: 200, winType: 'submission' })
    expect(view.clock).toEqual({ elapsedMs: 12_000, startedAt: null, lengthMs: 300_000 })
    expect(view.endedAt).toBe('2026-10-03T15:41:00.000Z')
    expect(view.lastSeq).toBe(6)
  })

  it('carries no result for a match that has none', () => {
    const view = matchViewOf({ ...row, status: 'pending', winnerAthleteId: null, winType: null }, detail, null)
    expect(view.result).toBeNull()
  })

  it('names a competitor the roster does not hold rather than rendering a blank', () => {
    const view = matchViewOf(row, { athletes: [] } as unknown as EventDetail, null)
    expect(view.a.name).toBe('Unknown')
    expect(view.a.teamId).toBeNull()
  })
})
