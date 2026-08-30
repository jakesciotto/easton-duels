import { describe, it, expect } from 'vitest'
import { createTestApp, call } from './helpers.js'

describe('GET /api/lan', () => {
  it('serves the LAN url on the app port without a token', async () => {
    const { app } = createTestApp({ port: 8422 })
    const r = await call(app, 'GET', '/api/lan')
    expect(r.status).toBe(200)
    expect(r.body.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:8422$/)
  })
})
