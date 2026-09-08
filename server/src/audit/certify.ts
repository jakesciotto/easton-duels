import { eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, matches, mats, athletes, teams, rulesets } from '../db/schema.js'
import { MatchStateError } from '../match/events.js'

// The one sentence every locked write answers with. The web client matches on it, so it
// is a contract rather than wording.
export const CERTIFIED_MESSAGE = 'event is certified'

/**
 * The lock. Certification is the organizer's signature on the record, so it stops every
 * write on the event rather than only the results: a roster edit or a reordered match
 * list changes what the certified record says as surely as a score does.
 *
 * An event that is not there is not this guard's problem; the route's own 404 says so.
 */
export async function assertNotCertified(db: DbLike, eventId: number): Promise<void> {
  const ev = await db.select({ status: events.status }).from(events).where(eq(events.id, eventId)).get()
  if (ev?.status === 'certified') throw new MatchStateError(CERTIFIED_MESSAGE)
}

export type CertifyScope = 'match' | 'mat' | 'athlete' | 'team' | 'ruleset'

// Most write routes are addressed by something under the event rather than by the event,
// so the guard resolves upwards first.
export async function eventIdOf(db: DbLike, scope: CertifyScope, id: number): Promise<number | null> {
  const row = scope === 'match' ? await db.select({ eventId: matches.eventId }).from(matches).where(eq(matches.id, id)).get()
    : scope === 'mat' ? await db.select({ eventId: mats.eventId }).from(mats).where(eq(mats.id, id)).get()
    : scope === 'athlete' ? await db.select({ eventId: athletes.eventId }).from(athletes).where(eq(athletes.id, id)).get()
    : scope === 'team' ? await db.select({ eventId: teams.eventId }).from(teams).where(eq(teams.id, id)).get()
    : await db.select({ eventId: rulesets.eventId }).from(rulesets).where(eq(rulesets.id, id)).get()
  return row?.eventId ?? null
}

export async function assertNotCertifiedVia(db: DbLike, scope: CertifyScope, id: number): Promise<void> {
  const eventId = await eventIdOf(db, scope, id)
  if (eventId !== null) await assertNotCertified(db, eventId)
}
