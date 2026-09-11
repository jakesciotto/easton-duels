import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call, TEST_PIN } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { enterResult } from '../src/match/entry.js'
import { auditLog, athletes, events, mats, matches, rosterCandidates } from '../src/db/schema.js'
import { TEAM_COLOR_KEYS } from '../src/shared/types.js'

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

  it('carries the organizer contact on create, patch, detail, and the snapshot', async () => {
    const { app, adminToken } = await createTestApp()

    const blank = await call(app, 'POST', '/api/events', body, adminToken)
    expect(blank.body.event.contact).toBeNull()

    const named = await call(app, 'POST', '/api/events', { ...body, contactName: '  Dana Whitlock  ', contactPhone: '555-0142' }, adminToken)
    expect(named.body.event.contact).toEqual({ name: 'Dana Whitlock', phone: '555-0142' })
    expect((await call(app, 'GET', `/api/events/${named.body.event.id}/snapshot`)).body.snapshot.event.contact).toEqual({ name: 'Dana Whitlock', phone: '555-0142' })

    const half = await call(app, 'PATCH', `/api/events/${blank.body.event.id}`, { contactName: 'Dana Whitlock' }, adminToken)
    expect(half.body.event.contact).toBeNull()
    const whole = await call(app, 'PATCH', `/api/events/${blank.body.event.id}`, { contactPhone: '555-0142' }, adminToken)
    expect(whole.body.event.contact).toEqual({ name: 'Dana Whitlock', phone: '555-0142' })

    const cleared = await call(app, 'PATCH', `/api/events/${blank.body.event.id}`, { contactPhone: '' }, adminToken)
    expect(cleared.body.event.contact).toBeNull()
    expect(cleared.body.event.contactPhone).toBeNull()

    expect((await call(app, 'PATCH', `/api/events/${blank.body.event.id}`, { contactName: 'x'.repeat(61) }, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', '/api/events', { ...body, contactPhone: '5'.repeat(31) }, adminToken)).status).toBe(422)
  })

  // G24: the far correction lives on the event so a second browser or a cleared cache
  // reads the same number, rather than in a query string or localStorage.
  it('carries the far correction on patch, detail, and the snapshot, and clears with null', async () => {
    const { app, adminToken } = await createTestApp()

    const created = await call(app, 'POST', '/api/events', body, adminToken)
    expect(created.body.event.far).toBeNull()
    const eventId = created.body.event.id

    const set = await call(app, 'PATCH', `/api/events/${eventId}`, { far: 1.1 }, adminToken)
    expect(set.status).toBe(200)
    expect(set.body.event.far).toBe(1.1)
    expect((await call(app, 'GET', `/api/events/${eventId}/snapshot`)).body.snapshot.event.far).toBe(1.1)
    expect((await call(app, 'GET', `/api/events/${eventId}`, undefined, adminToken)).body.event.far).toBe(1.1)

    const cleared = await call(app, 'PATCH', `/api/events/${eventId}`, { far: null }, adminToken)
    expect(cleared.body.event.far).toBeNull()

    expect((await call(app, 'PATCH', `/api/events/${eventId}`, { far: 0.84 }, adminToken)).status).toBe(422)
    expect((await call(app, 'PATCH', `/api/events/${eventId}`, { far: 1.21 }, adminToken)).status).toBe(422)
  })

  it('loads every idle mat when a running desk event switches to the mats', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matCount: 2, mode: 'entry' })

    expect((await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'live' }, adminToken)).status).toBe(200)
    expect((await db.select().from(mats).where(eq(mats.eventId, s.eventId)).all()).map(m => m.currentMatchId)).toEqual([null, null])

    const switched = await call(app, 'PATCH', `/api/events/${s.eventId}`, { mode: 'live' }, adminToken)
    expect(switched.status).toBe(200)
    expect(switched.body.event.mode).toBe('live')
    expect((await db.select().from(mats).where(eq(mats.eventId, s.eventId)).all()).map(m => m.currentMatchId)).toEqual(s.matchIds)
    expect((await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).map(m => m.status)).toEqual(['live', 'live'])
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

  it('takes two to eight teams, each with its own colour', async () => {
    const { app, adminToken } = await createTestApp()
    const team = (i: number) => ({ name: `Team ${i}`, color: TEAM_COLOR_KEYS[i] })
    const eight = await call(app, 'POST', '/api/events', { ...body, teams: TEAM_COLOR_KEYS.map((_, i) => team(i)) }, adminToken)
    expect(eight.status).toBe(201)
    expect(eight.body.teams.map((t: any) => t.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

    expect((await call(app, 'POST', '/api/events', { ...body, teams: [team(0)] }, adminToken)).status).toBe(422)
    const nine = [...TEAM_COLOR_KEYS.map((_, i) => team(i)), { name: 'Team 8', color: 'red' }]
    expect((await call(app, 'POST', '/api/events', { ...body, teams: nine }, adminToken)).status).toBe(422)
    const twin = await call(app, 'POST', '/api/events', { ...body, teams: [team(0), { name: 'Team 1', color: TEAM_COLOR_KEYS[0] }] }, adminToken)
    expect(twin.status).toBe(422)
    expect(twin.body.error.message).toMatch(/colour/)
  })

  it('adds a team up to eight, refusing a colour another team holds', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    const added = await call(app, 'POST', `/api/events/${s.eventId}/teams`, { name: 'Hillcrest', color: 'green' }, adminToken)
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ eventId: s.eventId, name: 'Hillcrest', color: 'green', position: 2 })
    expect((await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)).body.teams).toHaveLength(3)

    const taken = await call(app, 'POST', `/api/events/${s.eventId}/teams`, { name: 'Copycat', color: 'red' }, adminToken)
    expect(taken.status).toBe(422)
    expect(taken.body.error.code).toBe('validation')
    for (const color of TEAM_COLOR_KEYS.slice(3)) {
      expect((await call(app, 'POST', `/api/events/${s.eventId}/teams`, { name: color, color }, adminToken)).status).toBe(201)
    }
    const ninth = await call(app, 'POST', `/api/events/${s.eventId}/teams`, { name: 'One too many', color: 'red' }, adminToken)
    expect(ninth.status).toBe(422)
    expect((await call(app, 'POST', '/api/events/9999/teams', { name: 'Nowhere', color: 'red' }, adminToken)).status).toBe(404)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/teams`, { name: 'No token', color: 'pink' })).status).toBe(401)
  })

  it('removes an empty team, keeps two, and refuses one with competitors on it', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { thirdTeam: true })
    const used = await call(app, 'DELETE', `/api/events/${s.eventId}/teams/${s.teamA}`, undefined, adminToken)
    expect(used.status).toBe(409)
    expect(used.body.error.code).toBe('team_in_use')

    expect((await call(app, 'DELETE', `/api/events/${s.eventId}/teams/${s.teamC}`, undefined, adminToken)).status).toBe(204)
    expect((await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)).body.teams).toHaveLength(2)

    // Two left is the floor: an empty team cannot be removed once it is one of them.
    await db.delete(matches).where(eq(matches.eventId, s.eventId)).run()
    await db.delete(athletes).where(eq(athletes.eventId, s.eventId)).run()
    const last = await call(app, 'DELETE', `/api/events/${s.eventId}/teams/${s.teamB}`, undefined, adminToken)
    expect(last.status).toBe(422)
    expect(last.body.error.message).toMatch(/two teams/)
    expect((await call(app, 'DELETE', `/api/events/${s.eventId}/teams/9999`, undefined, adminToken)).status).toBe(404)
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

  it('renames a team and serves connect info', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    const t = await call(app, 'PATCH', `/api/events/${s.eventId}/teams/${s.teamA}`, { name: 'Ridgeline Bears', color: 'teal' }, adminToken)
    expect(t.body.teams[0]).toMatchObject({ name: 'Ridgeline Bears', color: 'teal' })
    const clash = await call(app, 'PATCH', `/api/events/${s.eventId}/teams/${s.teamA}`, { color: 'blue' }, adminToken)
    expect(clash.status).toBe(422)
    expect(clash.body.error.message).toMatch(/colour/)
    // Its own colour is not a clash with itself.
    expect((await call(app, 'PATCH', `/api/events/${s.eventId}/teams/${s.teamA}`, { color: 'teal' }, adminToken)).status).toBe(200)
    const c = await call(app, 'GET', `/api/events/${s.eventId}/connect`, undefined, adminToken)
    expect(c.body.matCode).toBe('0420')
    expect(c.body.url).toMatch(/^http:\/\/[\d.]+:\d+$/)
  })

  describe('delete event', () => {
    it('deletes a setup event on a plain {}, taking its athletes, matches and candidates with it while the audit row survives', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db)
      await db.insert(rosterCandidates).values({ eventId: s.eventId, wlUid: 'w1', firstName: 'Ana', lastName: 'Reyes' }).run()
      const r = await call(app, 'DELETE', `/api/events/${s.eventId}`, {}, adminToken)
      expect(r.status).toBe(204)
      expect((await call(app, 'GET', `/api/events/${s.eventId}`, undefined, adminToken)).status).toBe(404)
      expect(await db.select().from(athletes).where(eq(athletes.eventId, s.eventId)).all()).toEqual([])
      expect(await db.select().from(matches).where(eq(matches.eventId, s.eventId)).all()).toEqual([])
      expect(await db.select().from(rosterCandidates).where(eq(rosterCandidates.eventId, s.eventId)).all()).toEqual([])
      const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).all()
      const row = rows.find(r2 => r2.action === 'delete')
      expect(row?.detail).toMatchObject({ name: 'Fall Duels', date: '2026-10-03', status: 'setup', athletes: 4, matches: 2, results: 0 })
    })

    it('422s pin_required on a live event with {}, then 401s a wrong PIN, then 204s the right one', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { live: true })
      await db.update(matches).set({ status: 'done' }).where(eq(matches.id, s.matchIds[0])).run()
      const noPin = await call(app, 'DELETE', `/api/events/${s.eventId}`, {}, adminToken)
      expect(noPin.status).toBe(422)
      expect(noPin.body.error.code).toBe('pin_required')

      const wrong = await call(app, 'DELETE', `/api/events/${s.eventId}`, { pin: '000000' }, adminToken)
      expect(wrong.status).toBe(401)
      expect(wrong.body.error.code).toBe('bad_pin')

      const right = await call(app, 'DELETE', `/api/events/${s.eventId}`, { pin: TEST_PIN }, adminToken)
      expect(right.status).toBe(204)
      const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).all()
      expect(rows.find(r => r.action === 'delete')?.detail).toMatchObject({ status: 'live', results: 1 })
    })

    it('409s a certified event with or without the PIN', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matCount: 1, live: true, matches: 1 })
      await call(app, 'POST', `/api/matches/${s.matchIds[0]}/end`, { id: 'del-end-1', lastSeq: 0, winnerAthleteId: s.a1 }, adminToken)
      await call(app, 'PATCH', `/api/events/${s.eventId}`, { status: 'done' }, adminToken)
      await call(app, 'POST', `/api/events/${s.eventId}/certify`, { pin: TEST_PIN }, adminToken)

      const noPin = await call(app, 'DELETE', `/api/events/${s.eventId}`, {}, adminToken)
      expect(noPin.status).toBe(409)
      expect(noPin.body.error.code).toBe('match_state')
      expect(noPin.body.error.message).toBe('unlock the results first')

      const withPin = await call(app, 'DELETE', `/api/events/${s.eventId}`, { pin: TEST_PIN }, adminToken)
      expect(withPin.status).toBe(409)
      expect(withPin.body.error.message).toBe('unlock the results first')

      expect((await db.select().from(events).where(eq(events.id, s.eventId)).all())).toHaveLength(1)
    })

    it('404s an unknown event', async () => {
      const { app, adminToken } = await createTestApp()
      expect((await call(app, 'DELETE', '/api/events/999999', {}, adminToken)).status).toBe(404)
    })
  })
})
