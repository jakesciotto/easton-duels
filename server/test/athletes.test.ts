import { describe, it, expect } from 'vitest'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'

const candidate = {
  wlUid: 'u100', firstName: 'Zoe', lastName: 'Martin', belt: 'grey', wlLocation: 'Boulder',
  leaderboardId: 'zoe-martin', erp: 5.2, age: 8, weightLbs: 60, gender: 'F',
}

describe('athletes', () => {
  it('adds a manual kid into the pool with manual sources', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { manual: { firstName: 'Kai', lastName: 'Wong', age: 9, weightLbs: 66, belt: 'yellow', gender: 'M' } }, adminToken)
    expect(r.status).toBe(201)
    const kai = r.body.find((a: any) => a.firstName === 'Kai')
    expect(kai).toMatchObject({ teamId: null, source: 'manual', ageSource: 'manual', weightSource: 'manual', erp: null })
  })

  it('upserts candidates by wl uid and keeps manual age and weight', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    let r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [candidate] }, adminToken)
    const zoe = r.body.find((a: any) => a.wlUid === 'u100')
    expect(zoe).toMatchObject({ source: 'wl', ageSource: 'leaderboard', weightSource: 'leaderboard', erp: 5.2, age: 8 })
    await call(app, 'PATCH', `/api/athletes/${zoe.id}`, { age: 9 }, adminToken)
    r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { candidates: [{ ...candidate, age: 10, erp: 5.9 }] }, adminToken)
    const again = r.body.filter((a: any) => a.wlUid === 'u100')
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ age: 9, ageSource: 'manual', erp: 5.9 })
  })

  it('assigns teams, patches fields, and refuses to delete a kid in a match', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db)
    const moved = await call(app, 'POST', `/api/events/${s.eventId}/athletes/assign`, { ids: [s.a1], teamId: s.teamB }, adminToken)
    expect(moved.body.find((a: any) => a.id === s.a1).teamId).toBe(s.teamB)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/athletes/assign`, { ids: [s.a1], teamId: 999 }, adminToken)).status).toBe(422)
    const p = await call(app, 'PATCH', `/api/athletes/${s.a1}`, { weightLbs: 64, teamId: null }, adminToken)
    expect(p.body).toMatchObject({ weightLbs: 64, weightSource: 'manual', teamId: null })
    expect((await call(app, 'DELETE', `/api/athletes/${s.a1}`, undefined, adminToken)).status).toBe(409)
    const s2 = seedEvent(db, { matches: 0 })
    expect((await call(app, 'DELETE', `/api/athletes/${s2.a1}`, undefined, adminToken)).status).toBe(204)
  })

  it('adds a bulk list of manual kids', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    const r = await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { bulk: [
      { firstName: 'Ana', lastName: 'Bell', age: 7, weightLbs: 52, belt: 'white', gender: 'F', teamId: s.teamA },
      { firstName: 'Eli', lastName: 'Cruz', teamId: s.teamB },
    ] }, adminToken)
    expect(r.status).toBe(201)
    expect(r.body.filter((a: any) => a.source === 'manual')).toHaveLength(6)
    expect(r.body.find((a: any) => a.lastName === 'Cruz')).toMatchObject({ age: null, ageSource: null, teamId: s.teamB })
    expect((await call(app, 'POST', `/api/events/${s.eventId}/athletes`, { bulk: [{ firstName: 'X', lastName: 'Y', teamId: 999 }] }, adminToken)).status).toBe(422)
  })
})
