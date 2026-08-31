import { describe, it, expect } from 'vitest'
import { getOrCreateSecret } from '../src/db/client.js'
import { events, teams, athletes } from '../src/db/schema.js'
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
})
