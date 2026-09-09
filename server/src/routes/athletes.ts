import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, inArray, or } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, matches, rosterCandidates } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { eventDetail } from './events.js'
import { bumpVersion } from '../match/events.js'
import { recordAudit } from '../audit/log.js'
import { assertNotCertified } from '../audit/certify.js'
import { fullName, linkUpdate } from '../roster/link.js'
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
  // Added in 0010. A body written by an older client carries no date, which reads as none.
  promotedAt: z.string().nullable().default(null),
})

const addSchema = z.union([
  z.object({ manual: manualSchema }),
  z.object({ bulk: z.array(manualSchema).min(1).max(200) }),
  z.object({ candidates: z.array(candidateSchema).min(1).max(500), teamId: z.number().int().nullable().optional() }),
])

const patchSchema = manualSchema.partial()

async function teamBelongs(db: DbLike, eventId: number, teamId: number | null | undefined): Promise<boolean> {
  if (teamId === null || teamId === undefined) return true
  const t = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.eventId, eventId))).get()
  return t !== undefined
}

export async function upsertCandidates(db: DbLike, eventId: number, candidates: RosterCandidate[], teamId: number | null = null): Promise<void> {
  await db.transaction(async tx => {
    for (const cand of candidates) {
      const existing = await tx.select().from(athletes).where(and(eq(athletes.eventId, eventId), eq(athletes.wlUid, cand.wlUid))).get()
      const fromLeaderboard = {
        belt: cand.belt, promotedAt: cand.promotedAt, gender: cand.gender,
        wlLocation: cand.wlLocation, leaderboardId: cand.leaderboardId, erp: cand.erp,
      }
      if (!existing) {
        await tx.insert(athletes).values({
          eventId, firstName: cand.firstName, lastName: cand.lastName, source: 'wl', wlUid: cand.wlUid, teamId, ...fromLeaderboard,
          age: cand.age, ageSource: cand.age === null ? null : 'leaderboard',
          weightLbs: cand.weightLbs, weightSource: cand.weightLbs === null ? null : 'leaderboard',
        }).run()
        continue
      }
      const update = { firstName: cand.firstName, lastName: cand.lastName, ...linkUpdate(existing, cand) }
      await tx.update(athletes).set(update).where(eq(athletes.id, existing.id)).run()
    }
    await recordAudit(tx, { eventId, actor: 'admin', action: 'roster_add', detail: { kind: 'candidates', count: candidates.length, teamId } })
    await bumpVersion(tx, eventId)
  })
}

export const athleteRoutes = new Hono<Env>()

athleteRoutes.post('/events/:eventId/athletes', requireAdmin, validate('json', addSchema), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return errorJson(c, 404, 'not_found', 'event not found')
  await assertNotCertified(db, eventId)
  const body = c.req.valid('json')
  if ('manual' in body) {
    const m = body.manual
    if (!await teamBelongs(db, eventId, m.teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
    await db.transaction(async tx => {
      await tx.insert(athletes).values({
        eventId, firstName: m.firstName, lastName: m.lastName, source: 'manual', teamId: m.teamId ?? null,
        age: m.age ?? null, ageSource: m.age == null ? null : 'manual',
        weightLbs: m.weightLbs ?? null, weightSource: m.weightLbs == null ? null : 'manual',
        belt: m.belt ?? null, gender: m.gender ?? null,
      }).run()
      await recordAudit(tx, { eventId, actor: 'admin', action: 'roster_add', detail: { kind: 'manual', count: 1, name: `${m.firstName} ${m.lastName}` } })
      await bumpVersion(tx, eventId)
    })
  } else if ('bulk' in body) {
    for (const m of body.bulk) if (!await teamBelongs(db, eventId, m.teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
    await db.transaction(async tx => {
      for (const m of body.bulk) {
        await tx.insert(athletes).values({
          eventId, firstName: m.firstName, lastName: m.lastName, source: 'manual', teamId: m.teamId ?? null,
          age: m.age ?? null, ageSource: m.age == null ? null : 'manual',
          weightLbs: m.weightLbs ?? null, weightSource: m.weightLbs == null ? null : 'manual',
          belt: m.belt ?? null, gender: m.gender ?? null,
        }).run()
      }
      await recordAudit(tx, { eventId, actor: 'admin', action: 'roster_add', detail: { kind: 'bulk', count: body.bulk.length } })
      await bumpVersion(tx, eventId)
    })
  } else {
    if (!await teamBelongs(db, eventId, body.teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
    await upsertCandidates(db, eventId, body.candidates, body.teamId ?? null)
  }
  return c.json((await eventDetail(db, eventId))!.athletes, 201)
})

athleteRoutes.patch('/athletes/:athleteId', requireAdmin, validate('json', patchSchema), async c => {
  const { db } = c.get('ctx')
  const id = Number(c.req.param('athleteId'))
  const existing = await db.select().from(athletes).where(eq(athletes.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'athlete not found')
  await assertNotCertified(db, existing.eventId)
  const p = c.req.valid('json')
  if (p.teamId !== undefined && !await teamBelongs(db, existing.eventId, p.teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
  const update: Partial<typeof athletes.$inferInsert> = {}
  if (p.firstName !== undefined) update.firstName = p.firstName
  if (p.lastName !== undefined) update.lastName = p.lastName
  if (p.belt !== undefined) update.belt = p.belt
  if (p.gender !== undefined) update.gender = p.gender
  if (p.teamId !== undefined) update.teamId = p.teamId
  if (p.age !== undefined) Object.assign(update, { age: p.age, ageSource: p.age === null ? null : 'manual' })
  if (p.weightLbs !== undefined) Object.assign(update, { weightLbs: p.weightLbs, weightSource: p.weightLbs === null ? null : 'manual' })
  await db.transaction(async tx => {
    if (Object.keys(update).length > 0) await tx.update(athletes).set(update).where(eq(athletes.id, id)).run()
    await recordAudit(tx, {
      eventId: existing.eventId, actor: 'admin', action: 'roster_edit',
      detail: { athleteId: id, name: `${update.firstName ?? existing.firstName} ${update.lastName ?? existing.lastName}`, fields: Object.keys(update) },
    })
    await bumpVersion(tx, existing.eventId)
  })
  return c.json(await db.select().from(athletes).where(eq(athletes.id, id)).get())
})

athleteRoutes.post('/athletes/:athleteId/link', requireAdmin, validate('json', z.object({ wlUid: z.string().min(1) })), async c => {
  const { db } = c.get('ctx')
  const id = Number(c.req.param('athleteId'))
  const existing = await db.select().from(athletes).where(eq(athletes.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'athlete not found')
  await assertNotCertified(db, existing.eventId)
  const { wlUid } = c.req.valid('json')
  const cand = await db.select().from(rosterCandidates).where(and(eq(rosterCandidates.eventId, existing.eventId), eq(rosterCandidates.wlUid, wlUid))).get()
  if (!cand) return errorJson(c, 422, 'validation', 'no such candidate on this event')
  const taken = await db.select().from(athletes).where(and(eq(athletes.eventId, existing.eventId), eq(athletes.wlUid, wlUid))).get()
  if (taken) return errorJson(c, 409, 'duplicate', `${fullName(taken)} is already on the roster`)
  await db.transaction(async tx => {
    await tx.update(athletes).set(linkUpdate(existing, cand)).where(eq(athletes.id, id)).run()
    await recordAudit(tx, {
      eventId: existing.eventId, actor: 'admin', action: 'roster_link',
      detail: { kind: 'manual', athleteId: id, name: fullName(existing), wlUid },
    })
    await bumpVersion(tx, existing.eventId)
  })
  return c.json(await db.select().from(athletes).where(eq(athletes.id, id)).get())
})

athleteRoutes.post('/events/:eventId/athletes/assign', requireAdmin, validate('json', z.object({ ids: z.array(z.number().int()).min(1).max(500), teamId: z.number().int().nullable() })), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const { ids, teamId } = c.req.valid('json')
  await assertNotCertified(db, eventId)
  if (!await teamBelongs(db, eventId, teamId)) return errorJson(c, 422, 'validation', 'teamId is not on this event')
  await db.transaction(async tx => {
    await tx.update(athletes).set({ teamId }).where(and(eq(athletes.eventId, eventId), inArray(athletes.id, ids))).run()
    await recordAudit(tx, { eventId, actor: 'admin', action: 'roster_assign', detail: { count: ids.length, teamId } })
    await bumpVersion(tx, eventId)
  })
  return c.json((await eventDetail(db, eventId))!.athletes)
})

athleteRoutes.delete('/athletes/:athleteId', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const id = Number(c.req.param('athleteId'))
  const existing = await db.select().from(athletes).where(eq(athletes.id, id)).get()
  if (!existing) return errorJson(c, 404, 'not_found', 'athlete not found')
  await assertNotCertified(db, existing.eventId)
  const used = await db.select({ id: matches.id }).from(matches).where(or(eq(matches.athleteAId, id), eq(matches.athleteBId, id))).get()
  if (used) return errorJson(c, 409, 'match_state', 'athlete is in a match; delete the match first')
  await db.transaction(async tx => {
    await tx.delete(athletes).where(eq(athletes.id, id)).run()
    await recordAudit(tx, {
      eventId: existing.eventId, actor: 'admin', action: 'roster_remove',
      detail: { athleteId: id, name: `${existing.firstName} ${existing.lastName}` },
    })
    await bumpVersion(tx, existing.eventId)
  })
  return c.body(null, 204)
})
