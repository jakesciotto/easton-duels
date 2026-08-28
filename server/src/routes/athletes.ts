import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, inArray, or } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, matches } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { eventDetail } from './events.js'
import { KIDS_BELTS } from '../shared/types.js'
import type { RosterCandidate } from '../roster/types.js'

const name = z.string().trim().min(1).max(40)
const age = z.number().int().min(3).max(17)
const weight = z.number().int().min(20).max(250)
const belt = z.enum(KIDS_BELTS)
const gender = z.string().trim().max(10)

const manualSchema = z.object({
  firstName: name, lastName: name,
  age: age.nullable().optional(), weightLbs: weight.nullable().optional(),
  belt: belt.nullable().optional(), gender: gender.nullable().optional(),
  teamId: z.number().int().nullable().optional(),
})

const candidateSchema = z.object({
  wlUid: z.string().min(1), firstName: name, lastName: name, belt: z.string().nullable(), wlLocation: z.string(),
  leaderboardId: z.string().nullable(), erp: z.number().nullable(), age: z.number().int().nullable(),
  weightLbs: z.number().int().nullable(), gender: z.string().nullable(),
})

const addSchema = z.union([
  z.object({ manual: manualSchema }),
  z.object({ candidates: z.array(candidateSchema).min(1).max(500) }),
])

const patchSchema = manualSchema.partial()

function teamBelongs(db: DbLike, eventId: number, teamId: number | null | undefined): boolean {
  if (teamId === null || teamId === undefined) return true
  const t = db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.eventId, eventId))).get()
  return t !== undefined
}

export function upsertCandidates(db: DbLike, eventId: number, candidates: RosterCandidate[]): void {
  db.transaction(tx => {
    for (const cand of candidates) {
      const existing = tx.select().from(athletes).where(and(eq(athletes.eventId, eventId), eq(athletes.wlUid, cand.wlUid))).get()
      const fromLeaderboard = {
        belt: cand.belt, gender: cand.gender, wlLocation: cand.wlLocation, leaderboardId: cand.leaderboardId, erp: cand.erp,
      }
      if (!existing) {
        tx.insert(athletes).values({
          eventId, firstName: cand.firstName, lastName: cand.lastName, source: 'wl', wlUid: cand.wlUid, ...fromLeaderboard,
          age: cand.age, ageSource: cand.age === null ? null : 'leaderboard',
          weightLbs: cand.weightLbs, weightSource: cand.weightLbs === null ? null : 'leaderboard',
        }).run()
        continue
      }
      const update: Partial<typeof athletes.$inferInsert> = { firstName: cand.firstName, lastName: cand.lastName, ...fromLeaderboard }
      if (existing.ageSource !== 'manual' && cand.age !== null) Object.assign(update, { age: cand.age, ageSource: 'leaderboard' })
      if (existing.weightSource !== 'manual' && cand.weightLbs !== null) Object.assign(update, { weightLbs: cand.weightLbs, weightSource: 'leaderboard' })
      tx.update(athletes).set(update).where(eq(athletes.id, existing.id)).run()
    }
  })
}

export const athleteRoutes = new Hono<Env>()

athleteRoutes.post('/events/:eventId/athletes', requireAdmin, validate('json', addSchema), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  const body = c.req.valid('json')
  if ('manual' in body) {
    const m = body.manual
    if (!teamBelongs(db, eventId, m.teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
    db.insert(athletes).values({
      eventId, firstName: m.firstName, lastName: m.lastName, source: 'manual', teamId: m.teamId ?? null,
      age: m.age ?? null, ageSource: m.age == null ? null : 'manual',
      weightLbs: m.weightLbs ?? null, weightSource: m.weightLbs == null ? null : 'manual',
      belt: m.belt ?? null, gender: m.gender ?? null,
    }).run()
  } else {
    upsertCandidates(db, eventId, body.candidates)
  }
  hub.broadcast(eventId)
  return c.json(eventDetail(db, eventId)!.athletes, 201)
})

athleteRoutes.patch('/athletes/:athleteId', requireAdmin, validate('json', patchSchema), c => {
  const { db, hub } = c.get('ctx')
  const id = Number(c.req.param('athleteId'))
  const existing = db.select().from(athletes).where(eq(athletes.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'athlete not found')
  const p = c.req.valid('json')
  if (p.teamId !== undefined && !teamBelongs(db, existing.eventId, p.teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
  const update: Partial<typeof athletes.$inferInsert> = {}
  if (p.firstName !== undefined) update.firstName = p.firstName
  if (p.lastName !== undefined) update.lastName = p.lastName
  if (p.belt !== undefined) update.belt = p.belt
  if (p.gender !== undefined) update.gender = p.gender
  if (p.teamId !== undefined) update.teamId = p.teamId
  if (p.age !== undefined) Object.assign(update, { age: p.age, ageSource: p.age === null ? null : 'manual' })
  if (p.weightLbs !== undefined) Object.assign(update, { weightLbs: p.weightLbs, weightSource: p.weightLbs === null ? null : 'manual' })
  if (Object.keys(update).length > 0) db.update(athletes).set(update).where(eq(athletes.id, id)).run()
  hub.broadcast(existing.eventId)
  return c.json(db.select().from(athletes).where(eq(athletes.id, id)).get())
})

athleteRoutes.post('/events/:eventId/athletes/assign', requireAdmin, validate('json', z.object({ ids: z.array(z.number().int()).min(1).max(500), teamId: z.number().int().nullable() })), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const { ids, teamId } = c.req.valid('json')
  if (!teamBelongs(db, eventId, teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
  db.update(athletes).set({ teamId }).where(and(eq(athletes.eventId, eventId), inArray(athletes.id, ids))).run()
  hub.broadcast(eventId)
  return c.json(eventDetail(db, eventId)!.athletes)
})

athleteRoutes.delete('/athletes/:athleteId', requireAdmin, c => {
  const { db, hub } = c.get('ctx')
  const id = Number(c.req.param('athleteId'))
  const existing = db.select().from(athletes).where(eq(athletes.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'athlete not found')
  const used = db.select({ id: matches.id }).from(matches).where(or(eq(matches.athleteAId, id), eq(matches.athleteBId, id))).get()
  if (used) return errorJson(c, 409, 'match_state', 'athlete is in a match; delete the match first')
  db.delete(athletes).where(eq(athletes.id, id)).run()
  hub.broadcast(existing.eventId)
  return c.body(null, 204)
})
