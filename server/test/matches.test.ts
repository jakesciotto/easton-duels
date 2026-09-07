import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { mats, matches } from '../src/db/schema.js'

describe('match routes', () => {
  it('generates, creates by hand with team order fixed, patches, deletes, reorders', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
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

  it('starts a new match on an idle mat and on a mat added after Start', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true, matches: 0 })
    const created = await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.a1, athleteBId: s.b1, matId: s.matIds[0] }, adminToken)
    expect(created.status).toBe(201)
    expect((await db.select().from(matches).where(eq(matches.id, created.body.id)).get())?.status).toBe('live')
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(created.body.id)

    const grown = await call(app, 'PATCH', `/api/events/${s.eventId}`, { matCount: 2 }, adminToken)
    expect(grown.status).toBe(200)
    const addedMat = grown.body.mats.find((m: any) => m.number === 2)
    const second = await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.a2, athleteBId: s.b2, matId: null }, adminToken)
    const moved = await call(app, 'PATCH', `/api/matches/${second.body.id}`, { matId: addedMat.id }, adminToken)
    expect(moved.status).toBe(200)
    expect((await db.select().from(matches).where(eq(matches.id, second.body.id)).get())?.status).toBe('live')
    expect((await db.select().from(mats).where(eq(mats.id, addedMat.id)).get())?.currentMatchId).toBe(second.body.id)
  })

  it('advances an idle mat on request and refuses while one is showing a match', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const busy = await call(app, 'POST', `/api/mats/${s.matIds[0]}/advance`, undefined, adminToken)
    expect(busy.status).toBe(409)
    expect(busy.body.error.code).toBe('match_state')

    await db.update(matches).set({ status: 'done' }).where(eq(matches.id, s.matchIds[0])).run()
    const advanced = await call(app, 'POST', `/api/mats/${s.matIds[0]}/advance`, undefined, adminToken)
    expect(advanced.status).toBe(200)
    expect(advanced.body.match.id).toBe(s.matchIds[1])
    expect(advanced.body.version).toBeGreaterThan(0)
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBe(s.matchIds[1])

    await db.update(matches).set({ status: 'done' }).where(eq(matches.id, s.matchIds[1])).run()
    const empty = await call(app, 'POST', `/api/mats/${s.matIds[0]}/advance`, undefined, adminToken)
    expect(empty.status).toBe(200)
    expect(empty.body.match).toBeNull()
    expect((await call(app, 'POST', '/api/mats/9999/advance', undefined, adminToken)).status).toBe(404)
    expect((await call(app, 'POST', `/api/mats/${s.matIds[0]}/advance`)).status).toBe(401)
  })

  it('clears a mat pointer at the deleted match', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    await db.update(mats).set({ currentMatchId: s.matchIds[0] }).where(eq(mats.id, s.matIds[0])).run()
    expect((await call(app, 'DELETE', `/api/matches/${s.matchIds[0]}`, undefined, adminToken)).status).toBe(204)
    expect((await db.select().from(mats).where(eq(mats.id, s.matIds[0])).get())?.currentMatchId).toBeNull()
  })

  it('rejects same-team pairs, foreign athletes, and edits to live matches', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { live: true })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.a1, athleteBId: s.a2 }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/matches`, { athleteAId: s.a1, athleteBId: 999 }, adminToken)).status).toBe(422)
    expect((await call(app, 'PATCH', `/api/matches/${s.matchIds[0]}`, { lengthSec: 90 }, adminToken)).status).toBe(409)
    expect((await call(app, 'DELETE', `/api/matches/${s.matchIds[0]}`, undefined, adminToken)).status).toBe(409)
  })
})
