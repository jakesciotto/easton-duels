import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import { startEvent, advanceMat, reopenMatch, setResult, skipMatch } from '../src/match/mats.js'
import { appendMatchEvent, endMatch, loadMatch, MatchStateError } from '../src/match/events.js'
import { enterResult } from '../src/match/entry.js'
import { events, mats, matches } from '../src/db/schema.js'

describe('startEvent', () => {
  it('marks the event live and loads the first match on every mat', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 2 })
    await startEvent(db, s.eventId)
    expect((await db.select().from(events).where(eq(events.id, s.eventId)).get())?.status).toBe('live')
    const rows = await db.select().from(mats).where(eq(mats.eventId, s.eventId)).all()
    expect(rows.map(m => m.currentMatchId)).toEqual([s.matchIds[0], s.matchIds[1]])
    expect((await loadMatch(db, s.matchIds[0])).status).toBe('live')
  })

  it('refuses when the event is not in setup', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await expect(startEvent(db, s.eventId)).rejects.toThrow(MatchStateError)
  })
})

describe('advanceMat', () => {
  it('moves to the next pending match after the current one ends', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await endMatch(db, { id: 'end1', matchId: first, lastSeq: 0, winnerAthleteId: s.a1 })
    expect((await advanceMat(db, s.matIds[0]))?.id).toBe(second)
    expect((await loadMatch(db, second)).status).toBe('live')
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(second)
  })

  it('returns the current match while it is still live', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    expect((await advanceMat(db, s.matIds[0]))?.id).toBe(s.matchIds[0])
  })

  it('clears the mat when the queue is empty and does nothing in setup', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true, matches: 1 })
    await endMatch(db, { id: 'end1', matchId: s.matchIds[0], lastSeq: 0, winnerAthleteId: s.a1 })
    expect(await advanceMat(db, s.matIds[0])).toBeNull()
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBeNull()
    const db2 = await freshDb()
    const s2 = await seedEvent(db2)
    expect(await advanceMat(db2, s2.matIds[0])).toBeNull()
    expect((await loadMatch(db2, s2.matchIds[0])).status).toBe('pending')
  })
})

describe('reopenMatch', () => {
  it('reopens a done match and pulls back an untouched next match', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await endMatch(db, { id: 'end1', matchId: first, lastSeq: 0, winnerAthleteId: s.a1 })
    await advanceMat(db, s.matIds[0])
    const m = await reopenMatch(db, first)
    expect(m.status).toBe('live')
    expect(m.winnerAthleteId).toBeNull()
    expect((await loadMatch(db, second)).status).toBe('pending')
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(first)
  })

  it('refuses when the next match already has scoring events', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    await endMatch(db, { id: 'end1', matchId: first, lastSeq: 0, winnerAthleteId: s.a1 })
    await advanceMat(db, s.matIds[0])
    await appendMatchEvent(db, { id: 'e1', matchId: second, type: 'score', athleteId: s.a2, actionKey: 'takedown', lastSeq: 0 })
    await expect(reopenMatch(db, first)).rejects.toThrow(/already started/)
  })

  it('refuses while the event is in setup and works once it is done', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1 })
    await enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 2, pointsB: 0, winnerAthleteId: s.a1, winType: 'points' })
    await expect(reopenMatch(db, s.matchIds[0])).rejects.toThrow(/start the event/)
    await db.update(events).set({ status: 'done' }).where(eq(events.id, s.eventId)).run()
    expect((await reopenMatch(db, s.matchIds[0])).status).toBe('live')
  })

  it('refuses on a match that is not done', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await expect(reopenMatch(db, s.matchIds[0])).rejects.toThrow(MatchStateError)
  })
})

describe('setResult', () => {
  it('overrides the winner on a done match through an admin event', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await endMatch(db, { id: 'end1', matchId: s.matchIds[0], lastSeq: 0, winnerAthleteId: s.a1 })
    const m = await setResult(db, s.matchIds[0], { winnerAthleteId: s.b1, winType: 'decision' })
    expect(m.winnerAthleteId).toBe(s.b1)
    expect(m.status).toBe('done')
    expect(m.lastSeq).toBe(2)
  })
})

describe('skipMatch', () => {
  it('moves the current match to the end and advances the mat', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const [first, second] = s.matchIds
    const m = await skipMatch(db, first)
    expect(m.status).toBe('pending')
    expect(m.orderIndex).toBe(2)
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(second)
    expect((await loadMatch(db, second)).status).toBe('live')
  })

  it('refuses a match with scoring events', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await appendMatchEvent(db, { id: 'e1', matchId: s.matchIds[0], type: 'score', athleteId: s.a1, actionKey: 'takedown', lastSeq: 0 })
    await expect(skipMatch(db, s.matchIds[0])).rejects.toThrow(/undo/)
    await db.update(matches).set({ status: 'pending' }).where(eq(matches.id, s.matchIds[1])).run()
  })
})
