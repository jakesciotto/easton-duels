import { describe, it, expect } from 'vitest'
import { freshDb, seedEvent } from './fixtures.js'
import { expireClock } from '../src/match/expiry.js'
import { appendMatchEvent, loadMatch, loadEvents } from '../src/match/events.js'

const T0 = Date.parse('2026-08-27T18:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

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
