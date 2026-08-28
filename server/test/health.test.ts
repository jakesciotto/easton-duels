import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'

describe('health', () => {
  it('returns ok and a version', async () => {
    const app = createApp({ port: 8422 } as never)
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: '0.1.0' })
  })
})
