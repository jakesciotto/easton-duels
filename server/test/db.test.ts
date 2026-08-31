import { describe, it, expect } from 'vitest'
import { createDb, dbUrlFromEnv, getOrCreateSecret } from '../src/db/client.js'
import { events, teams, athletes, settings } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { freshDb } from './fixtures.js'

describe('db', () => {
  it('migrates and round-trips an event with teams', async () => {
    const db = await freshDb()
    const ev = await db.insert(events).values({ name: 'Fall Duels', date: '2026-10-03', matCount: 2, matCode: '0420', createdAt: '2026-08-27T00:00:00.000Z' }).returning().get()
    await db.insert(teams).values([
      { eventId: ev.id, name: 'Boulder', color: 'red', position: 0 },
      { eventId: ev.id, name: 'Denver', color: 'blue', position: 1 },
    ]).run()
    expect(await db.select().from(teams).where(eq(teams.eventId, ev.id)).all()).toHaveLength(2)
    expect(ev.status).toBe('setup')
    expect(ev.maxAgeGap).toBe(1)
  })

  it('cascades athletes on event delete and nulls team on team delete', async () => {
    const db = await freshDb()
    const ev = await db.insert(events).values({ name: 'X', date: '2026-10-03', matCount: 1, matCode: '0000', createdAt: 'now' }).returning().get()
    const team = await db.insert(teams).values({ eventId: ev.id, name: 'A', color: 'red', position: 0 }).returning().get()
    const kid = await db.insert(athletes).values({ eventId: ev.id, teamId: team.id, firstName: 'Test', lastName: 'Kid', source: 'manual' }).returning().get()
    await db.delete(teams).where(eq(teams.id, team.id)).run()
    expect((await db.select().from(athletes).where(eq(athletes.id, kid.id)).get())?.teamId).toBeNull()
    await db.delete(events).where(eq(events.id, ev.id)).run()
    expect(await db.select().from(athletes).all()).toHaveLength(0)
  })

  it('creates the secret once and returns the same value after', async () => {
    const db = await freshDb()
    const a = await getOrCreateSecret(db)
    const b = await getOrCreateSecret(db)
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan(30)
  })

  it('survives two callers racing to create the secret', async () => {
    const db = await freshDb()
    const [a, b] = await Promise.all([getOrCreateSecret(db), getOrCreateSecret(db)])
    expect(a).toBe(b)
    expect(await db.select().from(settings).all()).toHaveLength(1)
  })
})

describe('dbUrlFromEnv', () => {
  it('prefers an explicit DB_PATH over Turso credentials', () => {
    const r = dbUrlFromEnv({ DB_PATH: '/tmp/x.db', TURSO_DATABASE_URL: 'libsql://example.invalid', TURSO_AUTH_TOKEN: 't' })
    expect(r).toEqual({ url: 'file:/tmp/x.db' })
  })
  it('uses Turso when no DB_PATH is set', () => {
    const r = dbUrlFromEnv({ TURSO_DATABASE_URL: 'libsql://example.invalid', TURSO_AUTH_TOKEN: 't', DATA_DIR: './data' })
    expect(r).toEqual({ url: 'libsql://example.invalid', authToken: 't' })
  })
  it('falls back to the DATA_DIR file', () => {
    expect(dbUrlFromEnv({ DATA_DIR: './d' }).url).toBe('file:d/duels.db')
  })
})

describe('createDb retry wiring', () => {
  it('retries 401 responses through the injected fetch and stops at the budget', async () => {
    let calls = 0
    const always401 = (async () => {
      calls += 1
      return new Response('unauthorized', { status: 401 })
    }) as unknown as typeof fetch
    const db = createDb({ url: 'libsql://example.invalid', authToken: 't', fetchFn: always401 })
    await expect(db.select().from(settings).all()).rejects.toThrow()
    expect(calls).toBe(3)
  })
})
