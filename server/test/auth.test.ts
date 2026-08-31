import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { signToken, verifyToken, tokenExpiry } from '../src/auth/tokens.js'
import { pinMatches, validateAdminPin, randomMatCode } from '../src/auth/pin.js'
import { attachAuth, requireAdmin, requireMatOrAdmin } from '../src/auth/middleware.js'
import type { Env, AppContext } from '../src/context.js'

const SECRET = 'test-secret'

describe('tokens', () => {
  it('round-trips a payload', () => {
    const t = signToken({ role: 'admin', exp: tokenExpiry(0) }, SECRET)
    expect(verifyToken(t, SECRET, 0)).toEqual({ role: 'admin', exp: 86_400 })
  })
  it('rejects a bad signature, a wrong secret, and garbage', () => {
    const t = signToken({ role: 'admin', exp: tokenExpiry(0) }, SECRET)
    expect(verifyToken(t.slice(0, -2) + 'xx', SECRET, 0)).toBeNull()
    expect(verifyToken(t, 'other', 0)).toBeNull()
    expect(verifyToken('nope', SECRET, 0)).toBeNull()
  })
  it('rejects an expired token', () => {
    const t = signToken({ role: 'mat', eventId: 1, matId: 2, exp: 100 }, SECRET)
    expect(verifyToken(t, SECRET, 99_000)).not.toBeNull()
    expect(verifyToken(t, SECRET, 101_000)).toBeNull()
  })
})

describe('pin', () => {
  it('compares in constant time and validates the shape', () => {
    expect(pinMatches('123456', '123456')).toBe(true)
    expect(pinMatches('123457', '123456')).toBe(false)
    expect(pinMatches('12345', '123456')).toBe(false)
    expect(validateAdminPin('123456')).toBe('123456')
    expect(() => validateAdminPin('12345')).toThrow(/6 digits/)
    expect(() => validateAdminPin(undefined)).toThrow(/6 digits/)
  })
  it('makes 4-digit mat codes', () => {
    for (let i = 0; i < 20; i++) expect(randomMatCode()).toMatch(/^\d{4}$/)
  })
})

describe('middleware', () => {
  function build() {
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('ctx', { port: 0, db: null as never, secret: SECRET, adminPin: '123456' } as unknown as AppContext)
      await next()
    })
    app.use('*', attachAuth)
    app.get('/admin', requireAdmin, c => c.json({ ok: true }))
    app.get('/mat/:matId', requireMatOrAdmin(c => Number(c.req.param('matId'))), c => c.json({ ok: true }))
    return app
  }
  const admin = signToken({ role: 'admin', exp: tokenExpiry() }, SECRET)
  const mat2 = signToken({ role: 'mat', eventId: 1, matId: 2, exp: tokenExpiry() }, SECRET)

  it('401s without a token and 403s with the wrong role', async () => {
    const app = build()
    expect((await app.request('/admin')).status).toBe(401)
    expect((await app.request('/admin', { headers: { authorization: `Bearer ${mat2}` } })).status).toBe(403)
    expect((await app.request('/admin', { headers: { authorization: `Bearer ${admin}` } })).status).toBe(200)
  })
  it('lets a mat token through only for its own mat', async () => {
    const app = build()
    expect((await app.request('/mat/2', { headers: { authorization: `Bearer ${mat2}` } })).status).toBe(200)
    expect((await app.request('/mat/3', { headers: { authorization: `Bearer ${mat2}` } })).status).toBe(403)
    expect((await app.request('/mat/3', { headers: { authorization: `Bearer ${admin}` } })).status).toBe(200)
  })
})
