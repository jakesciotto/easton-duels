import { describe, it, expect, vi, afterEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestApp, call, matToken } from './helpers.js'
import { freshDb, seedEvent } from './fixtures.js'
import { expireOverdue } from '../src/match/lazyExpiry.js'
import { appendMatchEvent, loadMatch } from '../src/match/events.js'
import { events, matchEvents } from '../src/db/schema.js'
import { DEFAULT_LENGTH_SEC } from '../src/shared/types.js'

const T0 = Date.parse('2026-08-27T18:00:00.000Z')

afterEach(() => vi.useRealTimers())

describe('expireOverdue', () => {
  it('expires an elapsed clock during a snapshot poll', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    const token = matToken(s.eventId, s.matIds[0])

    vi.useFakeTimers({ now: T0 })
    const started = await call(app, 'POST', `/api/matches/${s.matchIds[0]}/events`, { id: 'clk-0001', type: 'clock_start', lastSeq: 0 }, token)
    expect(started.body.match.clock.startedAt).not.toBeNull()

    vi.setSystemTime(T0 + DEFAULT_LENGTH_SEC * 1000 + 5_000)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(r.status).toBe(200)
    const match = r.body.snapshot.matches.find((m: { id: number }) => m.id === s.matchIds[0])
    expect(match.clock.startedAt).toBeNull()
    expect(match.clock.elapsedMs).toBe(DEFAULT_LENGTH_SEC * 1000)
  })

  it('does not double-expire under two immediate polls', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await appendMatchEvent(db, { id: 'clk-0001', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0, at: new Date(T0).toISOString() })

    const nowMs = T0 + DEFAULT_LENGTH_SEC * 1000 + 5_000
    await Promise.all([
      expireOverdue(db, s.eventId, nowMs),
      expireOverdue(db, s.eventId, nowMs),
    ])

    const match = await loadMatch(db, s.matchIds[0])
    expect(match.clockStartedAt).toBeNull()
    expect(match.clockElapsedMs).toBe(DEFAULT_LENGTH_SEC * 1000)

    const pauses = await db.select().from(matchEvents)
      .where(and(eq(matchEvents.matchId, s.matchIds[0]), eq(matchEvents.type, 'clock_pause'))).all()
    expect(pauses).toHaveLength(1)

    const ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    expect(ev?.version).toBe(1)
  })

  it('does nothing when no live match has elapsed', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await expireOverdue(db, s.eventId, T0)
    const ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    expect(ev?.version).toBe(0)
  })
})
