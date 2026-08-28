import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { mats } from '../src/db/schema.js'

describe('match routes', () => {
  it('generates, creates by hand with team order fixed, patches, deletes, reorders', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    const gen = await call(app, 'POST', `/api/events/${s.eventId}/matches/generate`, undefined, adminToken)
    expect(gen.status).toBe(200)
    expect(gen.body.created).toBe(2)
    const manual = await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.b2, athleteBId: s.a1, lengthSec: 120 }, adminToken)
    expect(manual.status).toBe(201)
    expect(manual.body).toMatchObject({ athleteAId: s.a1, athleteBId: s.b2, lengthSec: 120, orderIndex: 2 })
    expect(manual.body.matId).not.toBeNull()
    const patched = await call(app, 'PATCH', `/api/matches/${manual.body.id}`, { lengthSec: 90, matId: s.matIds[1] }, adminToken)
    expect(patched.body).toMatchObject({ lengthSec: 90, matId: s.matIds[1] })
    const detail = await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)
    const ids = detail.body.matches.map((m: any) => m.id)
    const reordered = await call(app, 'POST', `/api/events/${s.eventId}/matches/reorder`, { ids: [...ids].reverse() }, adminToken)
    expect(reordered.body.map((m: any) => m.id)).toEqual([...ids].reverse())
    expect((await call(app, 'POST', `/api/events/${s.eventId}/matches/reorder`, { ids: ids.slice(1) }, adminToken)).status).toBe(422)
    expect((await call(app, 'DELETE', `/api/matches/${manual.body.id}`, undefined, adminToken)).status).toBe(204)
  })

  it('clears a mat pointer at the deleted match', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db)
    db.update(mats).set({ currentMatchId: s.matchIds[0] }).where(eq(mats.id, s.matIds[0])).run()
    expect((await call(app, 'DELETE', `/api/matches/${s.matchIds[0]}`, undefined, adminToken)).status).toBe(204)
    expect(db.select().from(mats).where(eq(mats.id, s.matIds[0])).get()?.currentMatchId).toBeNull()
  })

  it('rejects same-team pairs, foreign athletes, and edits to live matches', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { live: true })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.a1, athleteBId: s.a2 }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.a1, athleteBId: 999 }, adminToken)).status).toBe(422)
    expect((await call(app, 'PATCH', `/api/matches/${s.matchIds[0]}`, { lengthSec: 90 }, adminToken)).status).toBe(409)
    expect((await call(app, 'DELETE', `/api/matches/${s.matchIds[0]}`, undefined, adminToken)).status).toBe(409)
  })
})
