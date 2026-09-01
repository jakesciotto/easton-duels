import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { mats, matches, rosterCandidates } from '../src/db/schema.js'

const body = { name: 'Fall Duels', date: '2026-10-03', matCount: 2, teams: [{ name: 'Ridgeline', color: 'red' }, { name: 'Lakeside', color: 'blue' }] }

describe('events', () => {
  it('requires an admin token', async () => {
    const { app } = await createTestApp()
    expect((await call(app, 'GET', '/api/events')).status).toBe(401)
    expect((await call(app, 'POST', '/api/events', body)).status).toBe(401)
  })

  it('creates an event with teams, mats, a default ruleset, and a mat code', async () => {
    const { app, adminToken } = await createTestApp()
    const r = await call(app, 'POST', '/api/events', body, adminToken)
    expect(r.status).toBe(201)
    expect(r.body.event.matCode).toMatch(/^\d{4}$/)
    expect(r.body.event.status).toBe('setup')
    expect(r.body.teams.map((t: any) => [t.name, t.color, t.position])).toEqual([['Ridgeline', 'red', 0], ['Lakeside', 'blue', 1]])
    expect(r.body.mats.map((m: any) => m.number)).toEqual([1, 2])
    expect(r.body.rulesets).toHaveLength(1)
    expect(r.body.rulesets[0].actions.length).toBeGreaterThan(3)
    const list = await call(app, 'GET', '/api/events', undefined, adminToken)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].teams).toHaveLength(2)
    const one = await call(app, 'GET', `/api/events/${r.body.event.id}`, undefined, adminToken)
    expect(one.status).toBe(200)
    expect(one.body.athletes).toEqual([])
    expect(one.body.candidateCount).toBe(0)
  })

  it('counts the cached candidate pool on event detail', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    await db.insert(rosterCandidates).values([
      { eventId: s.eventId, wlUid: 'u1', firstName: 'Ana', lastName: 'Reyes' },
      { eventId: s.eventId, wlUid: 'u2', firstName: 'Kai', lastName: 'Voss' },
    ]).run()
    const r = await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)
    expect(r.body.candidateCount).toBe(2)
  })

  it('422s on a bad colour or mat count', async () => {
    const { app, adminToken } = await createTestApp()
    expect((await call(app, 'POST', '/api/events', { ...body, matCount: 0 }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', '/api/events', { ...body, teams: [{ name: 'A', color: 'mauve' }, body.teams[1]] }, adminToken)).status).toBe(422)
  })

  it('goes live through PATCH and loads the first match on each mat', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 2 })
    const before = (await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.version
    const r = await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'live' }, adminToken)
    expect(r.status).toBe(200)
    expect(r.body.event.status).toBe('live')
    expect((await db.select().from(mats).where(eq(mats.eventId, s.eventId)).all()).map(m => m.currentMatchId)).toEqual([s.matchIds[0], s.matchIds[1]])
    const after = (await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)).body.version
    expect(after).toBeGreaterThan(before)
    expect((await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'live' }, adminToken)).status).toBe(409)
    expect((await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'done' }, adminToken)).body.event.status).toBe('done')
  })

  it('adds mats on a higher count and refuses to drop a mat that has matches', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 2 })
    const up = await call(app, 'PATCH', `/api/events/${s.eventId}`, { matCount: 3 }, adminToken)
    expect(up.body.mats.map((m: any) => m.number)).toEqual([1, 2, 3])
    expect((await call(app, 'PATCH', `/api/events/${s.eventId}`, { matCount: 1 }, adminToken)).status).toBe(409)
    await db.update(matches).set({ matId: s.matIds[0] }).where(eq(matches.eventId, s.eventId)).run()
    const down = await call(app, 'PATCH', `/api/events/${s.eventId}`, { matCount: 1 }, adminToken)
    expect(down.status).toBe(200)
    expect(down.body.mats).toHaveLength(1)
  })

  it('renames a team, serves connect info, and deletes a setup event', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    const t = await call(app, 'PATCH', `/api/events/${s.eventId}/teams/${s.teamA}`, { name: 'Ridgeline Bears', color: 'teal' }, adminToken)
    expect(t.body.teams[0]).toMatchObject({ name: 'Ridgeline Bears', color: 'teal' })
    const c = await call(app, 'GET', `/api/events/${s.eventId}/connect`, undefined, adminToken)
    expect(c.body.matCode).toBe('0420')
    expect(c.body.url).toMatch(/^http:\/\/[\d.]+:\d+$/)
    expect((await call(app, 'DELETE', `/api/events/${s.eventId}`, undefined, adminToken)).status).toBe(204)
    expect((await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)).status).toBe(404)
    const live = await seedEvent(db, { live: true })
    expect((await call(app, 'DELETE', `/api/events/${live.eventId}`, undefined, adminToken)).status).toBe(409)
  })
})
