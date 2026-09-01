import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { enterResult } from '../src/match/entry.js'
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

  // How the event runs is a stored fact, because the walkthrough two weeks out decides it.
  // The app used to infer it from whether a mat happened to be bound at that instant, which
  // is why the board could change composition on a reload between bouts.
  it('defaults to live scoring, takes a mode on create, and changes it on patch', async () => {
    const { app, adminToken } = await createTestApp()

    const live = await call(app, 'POST', '/api/events', body, adminToken)
    expect(live.body.event.mode).toBe('live')

    const desk = await call(app, 'POST', '/api/events', { ...body, mode: 'entry' }, adminToken)
    expect(desk.body.event.mode).toBe('entry')

    // Changeable after the fact, and while the event is live: the desk path is the fallback
    // when the tablets do not work on the day, which is when it is most needed.
    const patched = await call(app, 'PATCH', `/api/events/${live.body.event.id}`, { mode: 'entry' }, adminToken)
    expect(patched.status).toBe(200)
    const after = await call(app, 'GET', `/api/events/${live.body.event.id}`, undefined, adminToken)
    expect(after.body.event.mode).toBe('entry')

    const bad = await call(app, 'PATCH', `/api/events/${live.body.event.id}`, { mode: 'whenever' }, adminToken)
    expect(bad.status).toBe(422)
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

  // Without endedAt on the wire the Entry ledger's At column can only be filled by
  // the browser that did the saving, so a reload or a second desk device renders
  // every row blank for the rest of the event.
  it('carries endedAt on every match in event detail', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 1, live: true })
    const at = '2026-10-03T18:07:00.000Z'
    await enterResult(db, s.matchIds[0], { entryId: 'entry-0001', pointsA: 4, pointsB: 2, winnerAthleteId: s.a1, winType: 'points', at })

    const r = await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)
    const rows: { id: number; status: string; endedAt: string | null }[] = r.body.matches
    expect(rows.find(m => m.id === s.matchIds[0])?.endedAt).toBe(at)
    expect(rows.find(m => m.id === s.matchIds[1])?.endedAt).toBeNull()
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
