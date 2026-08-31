import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, seedEvent } from './fixtures.js'
import { heartbeatMat, reapBound, BOUND_WINDOW_MS } from '../src/live/bound.js'
import { events, mats } from '../src/db/schema.js'

describe('bound', () => {
  it('binds on the first heartbeat and bumps the version once', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const matId = s.matIds[0]

    await heartbeatMat(db, matId, s.eventId, 10_000)
    let ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    let mat = await db.select().from(mats).where(eq(mats.id, matId)).get()
    expect(ev?.version).toBe(1)
    expect(mat?.bound).toBe(true)
    expect(mat?.lastHeartbeatAt).toBe(new Date(10_000).toISOString())

    await heartbeatMat(db, matId, s.eventId, 20_000)
    ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    mat = await db.select().from(mats).where(eq(mats.id, matId)).get()
    expect(ev?.version).toBe(1)
    expect(mat?.bound).toBe(true)
    expect(mat?.lastHeartbeatAt).toBe(new Date(20_000).toISOString())
  })

  it('reaps a mat 60s after its last heartbeat and bumps the version', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const matId = s.matIds[0]
    const t0 = 10_000

    await heartbeatMat(db, matId, s.eventId, t0)
    let ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    expect(ev?.version).toBe(1)

    await reapBound(db, s.eventId, t0 + BOUND_WINDOW_MS + 1_000)
    ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    let mat = await db.select().from(mats).where(eq(mats.id, matId)).get()
    expect(mat?.bound).toBe(false)
    expect(ev?.version).toBe(2)

    await reapBound(db, s.eventId, t0 + BOUND_WINDOW_MS + 2_000)
    ev = await db.select().from(events).where(eq(events.id, s.eventId)).get()
    mat = await db.select().from(mats).where(eq(mats.id, matId)).get()
    expect(mat?.bound).toBe(false)
    expect(ev?.version).toBe(2)
  })
})
