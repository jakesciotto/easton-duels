import { describe, it, expect } from 'vitest'
import { createTestApp, call } from './helpers.js'
import { seedEvent } from './fixtures.js'

const rs = {
  name: 'Wrestling', defaultLengthSec: 180,
  actions: [{ key: 'takedown', label: 'Takedown', points: 2 }, { key: 'nearfall', label: 'Near fall', points: 3 }],
  terminals: [{ key: 'pin', label: 'Pin', winType: 'submission' }],
}

describe('rulesets', () => {
  it('lists, creates, patches, and deletes', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db, { matches: 0 })
    expect((await call(app, 'GET', `/api/events/${s.eventId}/rulesets`, undefined, adminToken)).body).toHaveLength(1)
    const created = await call(app, 'POST', `/api/events/${s.eventId}/rulesets`, rs, adminToken)
    expect(created.status).toBe(201)
    const id = created.body.id
    const patched = await call(app, 'PATCH', `/api/rulesets/${id}`, { defaultLengthSec: 240 }, adminToken)
    expect(patched.body.defaultLengthSec).toBe(240)
    expect(patched.body.actions).toHaveLength(2)
    expect((await call(app, 'DELETE', `/api/rulesets/${id}`, undefined, adminToken)).status).toBe(204)
    expect((await call(app, 'GET', `/api/events/${s.eventId}/rulesets`, undefined, adminToken)).body).toHaveLength(1)
  })

  it('refuses to delete a referenced ruleset or the last one', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db)
    expect((await call(app, 'DELETE', `/api/rulesets/${s.rulesetId}`, undefined, adminToken)).status).toBe(409)
    const s2 = seedEvent(db, { matches: 0 })
    expect((await call(app, 'DELETE', `/api/rulesets/${s2.rulesetId}`, undefined, adminToken)).status).toBe(409)
  })

  it('422s on duplicate keys and bad shapes', async () => {
    const { app, db, adminToken } = createTestApp()
    const s = seedEvent(db)
    const dup = { ...rs, actions: [rs.actions[0], rs.actions[0]] }
    expect((await call(app, 'POST', `/api/events/${s.eventId}/rulesets`, dup, adminToken)).status).toBe(422)
    expect((await call(app, 'POST', `/api/events/${s.eventId}/rulesets`, { ...rs, defaultLengthSec: 5 }, adminToken)).status).toBe(422)
  })
})
