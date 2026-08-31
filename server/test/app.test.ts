import { describe, it, expect } from 'vitest'
import { createTestApp, call, TEST_PIN } from './helpers.js'
import { seedEvent } from './fixtures.js'

describe('POST /api/auth/admin', () => {
  it('returns a token for the right PIN and 401 for a wrong one', async () => {
    const { app } = await createTestApp()
    const ok = await call(app, 'POST', '/api/auth/admin', { pin: TEST_PIN })
    expect(ok.status).toBe(200)
    expect(typeof ok.body.token).toBe('string')
    const bad = await call(app, 'POST', '/api/auth/admin', { pin: '000000' })
    expect(bad.status).toBe(401)
    expect(bad.body.error.code).toBe('bad_pin')
  })

  it('rate limits after ten attempts', async () => {
    const { app } = await createTestApp()
    for (let i = 0; i < 10; i++) await call(app, 'POST', '/api/auth/admin', { pin: '000000' })
    const r = await call(app, 'POST', '/api/auth/admin', { pin: TEST_PIN })
    expect(r.status).toBe(429)
  })

  it('422s on a malformed body', async () => {
    const { app } = await createTestApp()
    const r = await call(app, 'POST', '/api/auth/admin', { nope: 1 })
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('validation')
  })
})

describe('snapshot polling', () => {
  it('serves a snapshot without a token and 404s an unknown event', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(r.status).toBe(200)
    expect(r.body.snapshot.event.id).toBe(s.eventId)
    expect((await call(app, 'GET', '/api/events/999/snapshot')).status).toBe(404)
  })

  it('returns the full snapshot when since is stale and a slim body when current', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const full = await call(app, 'GET', `/api/events/${s.eventId}/snapshot`)
    expect(full.status).toBe(200)
    expect(full.body.snapshot.event.id).toBe(s.eventId)
    const version = full.body.version
    const slim = await call(app, 'GET', `/api/events/${s.eventId}/snapshot?since=${version}`)
    expect(slim.status).toBe(200)
    expect(slim.body.version).toBe(version)
    expect(slim.body.snapshot).toBeUndefined()
    expect(typeof slim.body.now).toBe('string')
  })

  it('has no stream route', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/stream`)
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('not_found')
  })
})

describe('error mapping', () => {
  it('returns the standard 404 body for unknown routes', async () => {
    const { app } = await createTestApp()
    const r = await call(app, 'GET', '/api/nope')
    expect(r.status).toBe(404)
    expect(r.body).toEqual({ error: { code: 'not_found', message: 'not found' } })
  })
})
