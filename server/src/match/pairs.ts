import { and, asc, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { teams, athletes, mats, matches } from '../db/schema.js'

// Returns the pair with the kid from the earlier team first, or a message when the pair is
// invalid. An event holds up to eight teams, so the order is the teams' own, which is what
// makes a pair read the same whichever way round the console sent it.
export async function resolvePair(db: DbLike, eventId: number, aId: number, bId: number): Promise<{ a: number; b: number } | string> {
  const teamRows = await db.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all()
  const kids = await db.select().from(athletes).where(eq(athletes.eventId, eventId)).all()
  const a = kids.find(k => k.id === aId)
  const b = kids.find(k => k.id === bId)
  if (!a || !b) return 'both athletes must be on this event'
  if (a.id === b.id) return 'a kid cannot fight themself'
  if (a.teamId === null || b.teamId === null) return 'both athletes must be on a team'
  if (a.teamId === b.teamId) return 'athletes must be on different teams'
  const positionOf = new Map(teamRows.map(t => [t.id, t.position]))
  return (positionOf.get(a.teamId) ?? 0) <= (positionOf.get(b.teamId) ?? 0) ? { a: a.id, b: b.id } : { a: b.id, b: a.id }
}

export async function leastLoadedMat(db: DbLike, eventId: number): Promise<number | null> {
  const matRows = await db.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all()
  if (matRows.length === 0) return null
  const counts = new Map(matRows.map(m => [m.id, 0]))
  const pending = await db.select({ matId: matches.matId }).from(matches).where(and(eq(matches.eventId, eventId), eq(matches.status, 'pending'))).all()
  for (const m of pending) {
    if (m.matId !== null && counts.has(m.matId)) counts.set(m.matId, (counts.get(m.matId) ?? 0) + 1)
  }
  return [...counts.entries()].sort((x, y) => x[1] - y[1])[0][0]
}
