import { describe, it, expect } from 'vitest'
import { createTestApp, call } from './helpers.js'

describe('GET /api/lan', () => {
  it('serves the LAN url on the app port without a token', async () => {
    const { app } = await createTestApp({ port: 8422 })
    const r = await call(app, 'GET', '/api/lan')
    expect(r.status).toBe(200)
    expect(r.body.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:8422$/)
  })

  it('serves the public url instead when the context sets one', async () => {
    const { app } = await createTestApp({ port: 8422, publicUrl: 'https://www.eastonduels.com' })
    const r = await call(app, 'GET', '/api/lan')
    expect(r.status).toBe(200)
    expect(r.body.url).toBe('https://www.eastonduels.com')
  })
})
