import { describe, it, expect, vi, afterEach } from 'vitest'
import { freshDb, seedEvent } from './fixtures.js'
import { ExpiryScheduler, expireClock } from '../src/match/expiry.js'
import { appendMatchEvent, loadMatch, loadEvents } from '../src/match/events.js'

const T0 = Date.parse('2026-08-27T18:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

afterEach(() => vi.useRealTimers())

describe('ExpiryScheduler', () => {
  it('fires once at the expiry instant with that instant as the timestamp', () => {
    vi.useFakeTimers({ now: T0 })
    const fired: [number, string][] = []
    const sched = new ExpiryScheduler((id, at) => { fired.push([id, at]) })
    sched.schedule(7, T0 + 5_000)
    vi.advanceTimersByTime(4_999)
    expect(fired).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(fired).toEqual([[7, iso(T0 + 5_000)]])
    expect(sched.pendingCount()).toBe(0)
  })

  it('replaces an earlier timer for the same match and cancels on demand', () => {
    vi.useFakeTimers({ now: T0 })
    const fired: number[] = []
    const sched = new ExpiryScheduler(id => { fired.push(id) })
    sched.schedule(7, T0 + 1_000)
    sched.schedule(7, T0 + 3_000)
    sched.schedule(8, T0 + 2_000)
    sched.cancel(8)
    vi.advanceTimersByTime(3_000)
    expect(fired).toEqual([7])
  })

  it('sync schedules a running match and cancels a paused one; rebuild scans the db', async () => {
    vi.useFakeTimers({ now: T0 })
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    const sched = new ExpiryScheduler(() => {})
    const running = (await appendMatchEvent(db, { id: 'c1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0, at: iso(T0) })).match
    sched.sync(running)
    expect(sched.pendingCount()).toBe(1)
    const paused = (await appendMatchEvent(db, { id: 'c2', matchId: s.matchIds[0], type: 'clock_pause', lastSeq: 1, at: iso(T0 + 1_000) })).match
    sched.sync(paused)
    expect(sched.pendingCount()).toBe(0)
    await appendMatchEvent(db, { id: 'c3', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 2, at: iso(T0 + 2_000) })
    const other = new ExpiryScheduler(() => {})
    await other.rebuild(db)
    expect(other.pendingCount()).toBe(1)
    other.clear()
    expect(other.pendingCount()).toBe(0)
  })
})

describe('expireClock', () => {
  it('writes a pause at the expiry instant and caps elapsed at the length', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    await appendMatchEvent(db, { id: 'c1', matchId: s.matchIds[0], type: 'clock_start', lastSeq: 0, at: iso(T0) })
    const m = await expireClock(db, s.matchIds[0], iso(T0 + 300_000))
    expect(m?.clockStartedAt).toBeNull()
    expect(m?.clockElapsedMs).toBe(300_000)
    expect((await loadEvents(db, s.matchIds[0])).at(-1)?.at).toBe(iso(T0 + 300_000))
  })

  it('does nothing when the clock is already paused or the match is done', async () => {
    const db = await freshDb()
    const s = await seedEvent(db, { live: true })
    expect(await expireClock(db, s.matchIds[0], iso(T0))).toBeNull()
    expect((await loadMatch(db, s.matchIds[0])).lastSeq).toBe(0)
  })
})
