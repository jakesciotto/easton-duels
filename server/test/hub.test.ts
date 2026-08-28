import { describe, it, expect } from 'vitest'
import { freshDb, seedEvent } from './fixtures.js'
import { Hub } from '../src/live/hub.js'
import type { Snapshot } from '../src/shared/types.js'

describe('Hub', () => {
  it('sends a snapshot on subscribe and on every broadcast with a rising version', () => {
    const db = freshDb()
    const s = seedEvent(db)
    const hub = new Hub(db, () => 1_000)
    const got: Snapshot[] = []
    const unsubscribe = hub.subscribe(s.eventId, snap => got.push(snap))
    expect(got).toHaveLength(1)
    expect(got[0].version).toBe(0)
    hub.broadcast(s.eventId)
    hub.broadcast(s.eventId)
    expect(got.map(g => g.version)).toEqual([0, 1, 2])
    unsubscribe()
    hub.broadcast(s.eventId)
    expect(got).toHaveLength(3)
    expect(hub.subscriberCount(s.eventId)).toBe(0)
  })

  it('keeps versions per event', () => {
    const db = freshDb()
    const a = seedEvent(db)
    const b = seedEvent(db)
    const hub = new Hub(db)
    hub.broadcast(a.eventId)
    expect(hub.snapshot(a.eventId).version).toBe(1)
    expect(hub.snapshot(b.eventId).version).toBe(0)
  })

  it('reports a mat as bound for 60 seconds after a heartbeat', () => {
    const db = freshDb()
    const s = seedEvent(db)
    let now = 10_000
    const hub = new Hub(db, () => now)
    expect(hub.isBound(s.matIds[0])).toBe(false)
    hub.heartbeat(s.matIds[0])
    now += 59_000
    expect(hub.isBound(s.matIds[0])).toBe(true)
    expect(hub.snapshot(s.eventId).mats[0].bound).toBe(true)
    now += 2_000
    expect(hub.isBound(s.matIds[0])).toBe(false)
  })

  it('drops a subscriber that throws and keeps serving the others', () => {
    const db = freshDb()
    const s = seedEvent(db)
    const hub = new Hub(db)
    let ok = 0
    hub.subscribe(s.eventId, () => { throw new Error('closed socket') })
    hub.subscribe(s.eventId, () => { ok++ })
    hub.broadcast(s.eventId)
    expect(ok).toBe(2)
    expect(hub.subscriberCount(s.eventId)).toBe(1)
  })
})
