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

  it('rate limits after five failures', async () => {
    const { app } = await createTestApp()
    for (let i = 0; i < 5; i++) await call(app, 'POST', '/api/auth/admin', { pin: '000000' })
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

describe('board and stream', () => {
  it('serves a snapshot without a token and 404s an unknown event', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const r = await call(app, 'GET', `/api/events/${s.eventId}/board`)
    expect(r.status).toBe(200)
    expect(r.body.event.id).toBe(s.eventId)
    expect((await call(app, 'GET', '/api/events/999/board')).status).toBe(404)
  })

  it('streams the first snapshot as an SSE event', async () => {
    const { app, db } = await createTestApp()
    const s = await seedEvent(db)
    const res = await app.request(`/api/events/${s.eventId}/stream`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('event: snapshot')
    expect(text).toContain(`"id":${s.eventId}`)
    await reader.cancel()
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
