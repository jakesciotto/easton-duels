import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import { buildSnapshot } from '../src/live/snapshot.js'
import { appendMatchEvent, endMatch, bumpVersion } from '../src/match/events.js'
import { advanceMat, reopenMatch } from '../src/match/mats.js'
import { mats } from '../src/db/schema.js'
import { ON_DECK_DEPTH } from '../src/shared/types.js'

const opts = { nowMs: Date.parse('2026-08-27T18:00:00.000Z') }
const T = (s: number) => new Date(Date.parse('2026-08-27T18:00:00.000Z') + s * 1000).toISOString()

describe('buildSnapshot', () => {
  it('shapes event, teams, rulesets, mats, and matches', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await db.update(mats).set({ bound: true }).where(eq(mats.id, s.matIds[0])).run()
    const snap = await buildSnapshot(db, s.eventId, opts)
    expect(snap.version).toBe(0)
    expect(snap.now).toBe('2026-08-27T18:00:00.000Z')
    expect(snap.event).toEqual({ id: s.eventId, name: 'Fall Duels', date: '2026-10-03', status: 'live', matCount: 2 })
    expect(snap.teams.map(t => [t.name, t.wins, t.points])).toEqual([['Ridgeline', 0, 0], ['Lakeside', 0, 0]])
    expect(snap.rulesets[0].actions.find(a => a.key === 'mount')?.points).toBe(4)
    expect(snap.mats.map(m => [m.number, m.current?.id ?? null, m.bound])).toEqual([[1, s.matchIds[0], true], [2, s.matchIds[1], false]])
    expect(snap.matches[0].a).toMatchObject({ athleteId: s.a1, name: 'Mateo Rivera', teamId: s.teamA, belt: 'grey', weightLbs: 62, score: 0 })
    expect(snap.matches[0].clock).toEqual({ elapsedMs: 0, startedAt: null, lengthMs: 300_000 })
    expect(snap.matches[0].pendingTerminal).toBeNull()
  })

  it('tallies live points and done wins per team', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await appendMatchEvent(db, { id: 'e1', matchId: first, type: 'score', athleteId: s.a1, actionKey: 'mount', lastSeq: 0 })
    await appendMatchEvent(db, { id: 'e2', matchId: first, type: 'score', athleteId: s.b1, actionKey: 'takedown', lastSeq: 1 })
    let snap = await buildSnapshot(db, s.eventId, opts)
    expect(snap.teams.map(t => [t.wins, t.points])).toEqual([[0, 4], [0, 2]])
    await endMatch(db, { id: 'end1', matchId: first, lastSeq: 2 })
    await advanceMat(db, s.matIds[0])
    await appendMatchEvent(db, { id: 'e3', matchId: second, type: 'score', athleteId: s.b2, actionKey: 'pass', lastSeq: 0 })
    snap = await buildSnapshot(db, s.eventId, opts)
    expect(snap.teams.map(t => [t.wins, t.points])).toEqual([[1, 4], [0, 5]])
    expect(snap.matches[0].result).toEqual({ winnerAthleteId: s.a1, winType: 'points' })
  })

  it('lists on-deck matches per mat without the current one', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const snap = await buildSnapshot(db, s.eventId, opts)
    expect(snap.mats[0].current?.id).toBe(s.matchIds[0])
    expect(snap.mats[0].onDeck.map(m => m.id)).toEqual([s.matchIds[1]])
  })

  it('carries the queue depth the board budgets for, so a reserved line is never starved', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, matches: 8 })
    const snap = await buildSnapshot(db, s.eventId, opts)
    expect(snap.mats[0].onDeck.map(m => m.id)).toEqual(s.matchIds.slice(0, ON_DECK_DEPTH))
  })

  it('exposes a pending terminal', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await appendMatchEvent(db, { id: 't1', matchId: s.matchIds[0], type: 'terminal', athleteId: s.b1, actionKey: 'pin', lastSeq: 0 })
    expect((await buildSnapshot(db, s.eventId, opts)).matches[0].pendingTerminal).toEqual({ athleteId: s.b1, actionKey: 'pin' })
  })

  it('throws on an unknown event', async () => {
    await expect(buildSnapshot(await freshDb(), 999, opts)).rejects.toThrow(/not found/)
  })

  it('bumps the event version on a write and exposes it in the snapshot', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const before = (await buildSnapshot(db, s.eventId, opts)).version
    await bumpVersion(db, s.eventId)
    const after = (await buildSnapshot(db, s.eventId, opts)).version
    expect(after).toBe(before + 1)
  })

  it('exposes endedAt from the end event and updates it after a reopen and re-end', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first] = s.matchIds
    expect((await buildSnapshot(db, s.eventId, opts)).matches[0].endedAt).toBeNull()

    await endMatch(db, { id: 'end1', matchId: first, lastSeq: 0, winnerAthleteId: s.a1, at: T(0) })
    expect((await buildSnapshot(db, s.eventId, opts)).matches.find(m => m.id === first)?.endedAt).toBe(T(0))

    const reopened = await reopenMatch(db, first)
    // Reopening does not add a new end event, so the last known end time still shows
    // until the match is scored and ended again.
    expect((await buildSnapshot(db, s.eventId, opts)).matches.find(m => m.id === first)?.endedAt).toBe(T(0))

    await endMatch(db, { id: 'end2', matchId: first, lastSeq: reopened.lastSeq, winnerAthleteId: s.b1, at: T(120) })
    const rematched = (await buildSnapshot(db, s.eventId, opts)).matches.find(m => m.id === first)
    expect(rematched?.endedAt).toBe(T(120))
    expect(rematched?.result).toEqual({ winnerAthleteId: s.b1, winType: 'decision' })
  })
})
