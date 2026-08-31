import { describe, it, expect } from 'vitest'
import { freshDb, seedEvent } from './fixtures.js'
import { Hub } from '../src/live/hub.js'
import { bumpVersion } from '../src/match/events.js'
import type { Snapshot } from '../src/shared/types.js'

// The version a snapshot carries now comes from the events.version column, not the
// Hub's own counter, so every broadcast in these tests pairs with a bumpVersion call
// the same way every route handler pairs the two.
describe('Hub', () => {
  it('sends a snapshot on subscribe and on every broadcast with a rising version', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const hub = new Hub(db, () => 1_000)
    const got: Snapshot[] = []
    const unsubscribe = await hub.subscribe(s.eventId, snap => got.push(snap))
    expect(got).toHaveLength(1)
    expect(got[0].version).toBe(0)
    await bumpVersion(db, s.eventId)
    await hub.broadcast(s.eventId)
    await bumpVersion(db, s.eventId)
    await hub.broadcast(s.eventId)
    expect(got.map(g => g.version)).toEqual([0, 1, 2])
    unsubscribe()
    await hub.broadcast(s.eventId)
    expect(got).toHaveLength(3)
    expect(hub.subscriberCount(s.eventId)).toBe(0)
  })

  it('keeps versions per event', async () => {
    const db = await freshDb()
    const a = await seedEvent(db)
    const b = await seedEvent(db)
    const hub = new Hub(db)
    await bumpVersion(db, a.eventId)
    await hub.broadcast(a.eventId)
    expect((await hub.snapshot(a.eventId)).version).toBe(1)
    expect((await hub.snapshot(b.eventId)).version).toBe(0)
  })

  it('reports a mat as bound for 60 seconds after a heartbeat', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    let now = 10_000
    const hub = new Hub(db, () => now)
    expect(hub.isBound(s.matIds[0])).toBe(false)
    hub.heartbeat(s.matIds[0])
    now += 59_000
    expect(hub.isBound(s.matIds[0])).toBe(true)
    expect((await hub.snapshot(s.eventId)).mats[0].bound).toBe(true)
    now += 2_000
    expect(hub.isBound(s.matIds[0])).toBe(false)
  })

  it('drops a subscriber that throws and keeps serving the others', async () => {
    const db = await freshDb()
    const s = await seedEvent(db)
    const hub = new Hub(db)
    let ok = 0
    await hub.subscribe(s.eventId, () => { throw new Error('closed socket') })
    await hub.subscribe(s.eventId, () => { ok++ })
    await hub.broadcast(s.eventId)
    expect(ok).toBe(2)
    expect(hub.subscriberCount(s.eventId)).toBe(1)
  })
})
