import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'
import { athletes, auditLog, rosterCandidates } from '../src/db/schema.js'

const candidate = {
  wlUid: 'u100', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Ridgeline',
  leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'F',
}

describe('athletes', () => {
  it('adds a manual kid into the pool with manual sources', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { manual: { firstName: 'Kai', lastName: 'Wong', age: 9, weightLbs: 66, belt: 'yellow', gender: 'M' } }, adminToken)
    expect(r.status).toBe(201)
    const kai = r.body.find((a: any) => a.firstName === 'Kai')
    expect(kai).toMatchObject({ teamId: null, source: 'manual', ageSource: 'manual', weightSource: 'manual', erp: null })
  })

  it('upserts candidates by wl uid and keeps manual age and weight', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    let r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [candidate] }, adminToken)
    const zoe = r.body.find((a: any) => a.wlUid === 'u100')
    expect(zoe).toMatchObject({ source: 'wl', ageSource: 'leaderboard', weightSource: 'leaderboard', erp: 5.2, age: 8 })
    await call(app, 'PATCH', `/api/athletes/${zoe.id}`, { age: 9 }, adminToken)
    r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [{ ...candidate, age: 10, erp: 5.9 }] }, adminToken)
    const again = r.body.filter((a: any) => a.wlUid === 'u100')
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ age: 9, ageSource: 'manual', erp: 5.9 })
  })

  it('assigns a team to inserted candidates but leaves an existing match unchanged, and validates teamId', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [candidate], teamId: s.teamA }, adminToken)
    const zoe = r.body.find((a: any) => a.wlUid === 'u100')
    expect(zoe).toMatchObject({ teamId: s.teamA })
    // A resync of the same candidate never moves them off a team an admin already set.
    await call(app, 'PATCH', `/api/athletes/${zoe.id}`, { teamId: null }, adminToken)
    const again = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [candidate], teamId: s.teamB }, adminToken)
    expect(again.body.find((a: any) => a.wlUid === 'u100')).toMatchObject({ teamId: null })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [{ ...candidate, wlUid: 'u200' }], teamId: 999 }, adminToken)).status).toBe(422)
  })

  it('leaves candidates unassigned when no teamId is given, exactly as before', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [candidate] }, adminToken)
    expect(r.body.find((a: any) => a.wlUid === 'u100')).toMatchObject({ teamId: null })
  })

  it('assigns teams, patches fields, and refuses to delete a kid in a match', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db)
    const moved = await call(app, 'POST', `/api/events/${s.eventId}/athletes/assign`, { ids: [s.a1], teamId: s.teamB }, adminToken)
    expect(moved.body.find((a: any) => a.id === s.a1).teamId).toBe(s.teamB)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/athletes/assign`, { ids: [s.a1], teamId: 999 }, adminToken)).status).toBe(422)
    const p = await call(app, 'PATCH', `/api/athletes/${s.a1}`, { weightLbs: 64, teamId: null }, adminToken)
    expect(p.body).toMatchObject({ weightLbs: 64, weightSource: 'manual', teamId: null })
    expect((await call(app, 'DELETE', `/api/athletes/${s.a1}`, undefined, adminToken)).status).toBe(409)
    const s2 = await seedEvent(db, { matches: 0 })
    expect((await call(app, 'DELETE', `/api/athletes/${s2.a1}`, undefined, adminToken)).status).toBe(204)
  })

  it('adds a bulk list of manual kids', async () => {
    const { app, db, adminToken } = await createTestApp()
    const s = await seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { bulk: [
      { firstName: 'Ana', lastName: 'Bell', age: 7, weightLbs: 52, belt: 'white', gender: 'F', teamId: s.teamA },
      { firstName: 'Eli', lastName: 'Cruz', teamId: s.teamB },
    ] }, adminToken)
    expect(r.status).toBe(201)
    expect(r.body.filter((a: any) => a.source === 'manual')).toHaveLength(6)
    expect(r.body.find((a: any) => a.lastName === 'Cruz')).toMatchObject({ age: null, ageSource: null, teamId: s.teamB })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { bulk: [{ firstName: 'X', lastName: 'Y', teamId: 999 }] }, adminToken)).status).toBe(422)
  })

  describe('link route', () => {
    it('422s for a wlUid outside the pool', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matches: 0 })
      const r = await call(app, 'POST', `/api/athletes/${s.a1}/link`, { wlUid: 'missing' }, adminToken)
      expect(r.status).toBe(422)
      expect(r.body.error.code).toBe('validation')
    })

    it('409s when the candidate is already on another athlete of the event', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matches: 0 })
      await db.insert(rosterCandidates).values({ eventId: s.eventId, wlUid: 'w1', firstName: 'Ana', lastName: 'Reyes' }).run()
      await db.update(athletes).set({ wlUid: 'w1' }).where(eq(athletes.id, s.a2)).run()
      const r = await call(app, 'POST', `/api/athletes/${s.a1}/link`, { wlUid: 'w1' }, adminToken)
      expect(r.status).toBe(409)
      expect(r.body.error.code).toBe('duplicate')
      expect(r.body.error.message).toMatch(/is already on the roster/)
    })

    it('links, copying erp and belt from the candidate', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matches: 0 })
      await db.insert(rosterCandidates).values({
        eventId: s.eventId, wlUid: 'w2', firstName: 'Mateo', lastName: 'Rivera', belt: 'yellow', wlLocation: 'North',
        leaderboardId: 'mateo-rivera', erp: 4.9, age: 9, weightLbs: 68, gender: 'M',
      }).run()
      const r = await call(app, 'POST', `/api/athletes/${s.a1}/link`, { wlUid: 'w2' }, adminToken)
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ wlUid: 'w2', erp: 4.9, belt: 'yellow', age: 9, ageSource: 'leaderboard', weightLbs: 68, weightSource: 'leaderboard' })
    })

    it('404s for an unknown athlete', async () => {
      const { app, adminToken } = await createTestApp()
      expect((await call(app, 'POST', '/api/athletes/999999/link', { wlUid: 'w1' }, adminToken)).status).toBe(404)
    })

    it('clears the suggestion and dates the belt it wrote', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matches: 0 })
      await db.insert(rosterCandidates).values({
        eventId: s.eventId, wlUid: 'w2', firstName: 'Mateo', lastName: 'Rivera-Lopez', belt: 'yellow',
        wlLocation: 'Boulder', promotedAt: '2026-03-14',
      }).run()
      await db.update(athletes).set({ suggestedWlUid: 'w2', suggestedScore: 0.8 }).where(eq(athletes.id, s.a1)).run()

      const r = await call(app, 'POST', `/api/athletes/${s.a1}/link`, { wlUid: 'w2' }, adminToken)

      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ wlUid: 'w2', belt: 'yellow', promotedAt: '2026-03-14', suggestedWlUid: null, suggestedScore: null })
      expect(typeof r.body.syncedAt).toBe('string')
      expect(r.body.syncChanges).toMatchObject({ belt: { from: 'grey', to: 'yellow' }, promotedAt: { from: null, to: '2026-03-14' } })
    })
  })

  describe('dismiss route', () => {
    it('appends the uid, clears a suggestion naming it, and records the refusal', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matches: 0 })
      await db.update(athletes).set({ suggestedWlUid: 'w2', suggestedScore: 0.8 }).where(eq(athletes.id, s.a1)).run()

      const r = await call(app, 'POST', `/api/athletes/${s.a1}/dismiss`, { wlUid: 'w2' }, adminToken)

      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ dismissedWlUids: ['w2'], suggestedWlUid: null, suggestedScore: null })
      const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, s.eventId)).all()
      expect(rows.find(row => row.action === 'roster_edit')?.detail).toMatchObject({ kind: 'dismiss', athleteId: s.a1, name: 'Mateo Rivera', wlUid: 'w2' })
    })

    it('keeps a suggestion that names another candidate, and never lists a uid twice', async () => {
      const { app, db, adminToken } = await createTestApp()
      const s = await seedEvent(db, { matches: 0 })
      await db.update(athletes).set({ suggestedWlUid: 'w3', suggestedScore: 0.7 }).where(eq(athletes.id, s.a1)).run()

      await call(app, 'POST', `/api/athletes/${s.a1}/dismiss`, { wlUid: 'w2' }, adminToken)
      const again = await call(app, 'POST', `/api/athletes/${s.a1}/dismiss`, { wlUid: 'w2' }, adminToken)

      expect(again.body).toMatchObject({ dismissedWlUids: ['w2'], suggestedWlUid: 'w3', suggestedScore: 0.7 })
    })

    it('404s for an unknown athlete', async () => {
      const { app, adminToken } = await createTestApp()
      expect((await call(app, 'POST', '/api/athletes/999999/dismiss', { wlUid: 'w1' }, adminToken)).status).toBe(404)
    })
  })
})
