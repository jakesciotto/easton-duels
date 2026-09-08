import { Hono } from 'hono'
import { z } from 'zod'
import { asc, count, desc, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, rulesets, mats, matches, rosterCandidates } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { lanIp } from '../lib/lanIp.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { randomMatCode } from '../auth/pin.js'
import { advanceMat, startEvent } from '../match/mats.js'
import { MatchStateError, bumpVersion, endedAtByMatch } from '../match/events.js'
import { recordAudit } from '../audit/log.js'
import { eventContact } from '../live/snapshot.js'
import { DEFAULT_ACTIONS, DEFAULT_TERMINALS, DEFAULT_LENGTH_SEC, TEAM_COLOR_KEYS, type AuditAction, type TeamColor } from '../shared/types.js'

const colorSchema = z.enum(TEAM_COLOR_KEYS as [TeamColor, ...TeamColor[]])
export const teamSchema = z.object({ name: z.string().trim().min(1).max(40), color: colorSchema })
// Empty clears the field. A contact with only one half reads as absent everywhere, so
// there is nothing to gain from refusing a half-filled pair at the edge.
const contactName = z.string().trim().max(60)
const contactPhone = z.string().trim().max(30)
const maxAgeGap = z.number().int().min(0).max(10)
const maxWeightGap = z.number().int().min(0).max(100)
const sameGender = z.boolean()

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  matCount: z.number().int().min(1).max(8),
  mode: z.enum(['live', 'entry']).optional(),
  contactName: contactName.optional(),
  contactPhone: contactPhone.optional(),
  teams: z.tuple([teamSchema, teamSchema]),
  maxAgeGap: maxAgeGap.optional(),
  maxWeightGap: maxWeightGap.optional(),
  sameGender: sameGender.optional(),
})

const patchEventSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  matCount: z.number().int().min(1).max(8).optional(),
  status: z.enum(['live', 'done']).optional(),
  mode: z.enum(['live', 'entry']).optional(),
  contactName: contactName.optional(),
  contactPhone: contactPhone.optional(),
  maxAgeGap: maxAgeGap.optional(),
  maxWeightGap: maxWeightGap.optional(),
  sameGender: sameGender.optional(),
})

const blankToNull = (v: string | undefined) => v === undefined || v === '' ? null : v

export async function eventDetail(db: DbLike, eventId: number) {
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return null
  const candidateRow = await db.select({ n: count() }).from(rosterCandidates).where(eq(rosterCandidates.eventId, eventId)).get()
  const matchRows = await db.select().from(matches).where(eq(matches.eventId, eventId)).orderBy(asc(matches.orderIndex), asc(matches.id)).all()
  // The same derivation the snapshot uses, so the Entry ledger's At column survives a
  // reload and reads the same on a second desk device.
  const endedAtById = await endedAtByMatch(db, matchRows.map(m => m.id))
  return {
    event: { ...ev, contact: eventContact(ev) },
    teams: await db.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all(),
    athletes: await db.select().from(athletes).where(eq(athletes.eventId, eventId)).orderBy(asc(athletes.lastName), asc(athletes.firstName)).all(),
    rulesets: await db.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).all(),
    mats: await db.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all(),
    matches: matchRows.map(m => ({ ...m, endedAt: endedAtById.get(m.id) ?? null })),
    candidateCount: candidateRow?.n ?? 0,
  }
}

async function setMatCount(tx: DbLike, eventId: number, matCount: number) {
  const rows = await tx.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all()
  if (matCount > rows.length) {
    await tx.insert(mats).values(Array.from({ length: matCount - rows.length }, (_, i) => ({ eventId, number: rows.length + i + 1 }))).run()
  } else {
    for (const mat of rows.filter(m => m.number > matCount)) {
      const used = await tx.select({ id: matches.id }).from(matches).where(eq(matches.matId, mat.id)).get()
      if (used) throw new MatchStateError(`mat ${mat.number} has matches; move them first`)
      await tx.delete(mats).where(eq(mats.id, mat.id)).run()
    }
  }
  await tx.update(events).set({ matCount }).where(eq(events.id, eventId)).run()
}

export const eventRoutes = new Hono<Env>()

eventRoutes.get('/events', requireAdmin, async c => {
  const db = c.get('ctx').db
  const rows = await db.select().from(events).orderBy(desc(events.date), desc(events.id)).all()
  const teamRows = await db.select().from(teams).orderBy(asc(teams.position)).all()
  return c.json(rows.map(ev => ({ ...ev, teams: teamRows.filter(t => t.eventId === ev.id) })))
})

eventRoutes.post('/events', requireAdmin, validate('json', createEventSchema), async c => {
  const { db } = c.get('ctx')
  const body = c.req.valid('json')
  const detail = await db.transaction(async tx => {
    const ev = await tx.insert(events).values({
      name: body.name, date: body.date, matCount: body.matCount, matCode: randomMatCode(),
      mode: body.mode ?? 'live',
      contactName: blankToNull(body.contactName), contactPhone: blankToNull(body.contactPhone),
      maxAgeGap: body.maxAgeGap ?? 1, maxWeightGap: body.maxWeightGap ?? 10, sameGender: body.sameGender ?? false,
      createdAt: new Date().toISOString(),
    }).returning().get()
    await tx.insert(teams).values(body.teams.map((t, i) => ({ eventId: ev.id, name: t.name, color: t.color, position: i }))).run()
    await tx.insert(mats).values(Array.from({ length: body.matCount }, (_, i) => ({ eventId: ev.id, number: i + 1 }))).run()
    await tx.insert(rulesets).values({ eventId: ev.id, name: 'Default', defaultLengthSec: DEFAULT_LENGTH_SEC, actions: DEFAULT_ACTIONS, terminals: DEFAULT_TERMINALS }).run()
    await recordAudit(tx, {
      eventId: ev.id, actor: 'admin', action: 'create',
      detail: { name: ev.name, date: ev.date, matCount: ev.matCount, mode: ev.mode, teams: body.teams.map(t => t.name) },
    })
    await bumpVersion(tx, ev.id)
    return eventDetail(tx, ev.id)
  })
  return c.json(detail, 201)
})

eventRoutes.get('/events/:eventId', requireAdmin, async c => {
  const detail = await eventDetail(c.get('ctx').db, Number(c.req.param('eventId')))
  if (!detail) return errorJson(c, 404, 'not_found', 'event not found')
  return c.json(detail)
})

eventRoutes.patch('/events/:eventId', requireAdmin, validate('json', patchEventSchema), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  const { status, matCount, contactName: name, contactPhone: phone, mode, ...rest } = c.req.valid('json')
  const fields: Partial<typeof events.$inferInsert> = { ...rest }
  if (mode !== undefined) fields.mode = mode
  if (name !== undefined) fields.contactName = blankToNull(name)
  if (phone !== undefined) fields.contactPhone = blankToNull(phone)
  // One PATCH can carry several unrelated changes, and the history is read a line at a
  // time, so each concern the body actually changes gets its own row.
  await db.transaction(async tx => {
    const audit = (action: AuditAction, detail: Record<string, unknown>) => recordAudit(tx, { eventId, actor: 'admin', action, detail })
    if (Object.keys(fields).length > 0) await tx.update(events).set(fields).where(eq(events.id, eventId)).run()
    if (matCount !== undefined && matCount !== ev.matCount) {
      await setMatCount(tx, eventId, matCount)
      await audit('mat_count', { from: ev.matCount, to: matCount })
    }
    if (Object.keys(rest).length > 0) await audit('event_edit', { ...rest })
    if (mode !== undefined && mode !== ev.mode) await audit('mode', { from: ev.mode, to: mode })
    if (name !== undefined || phone !== undefined) await audit('contact', { name: fields.contactName ?? ev.contactName, phone: fields.contactPhone ?? ev.contactPhone })
    // Start skips the mats in entry mode, so an event that switches to the mats halfway
    // through the afternoon has to load them here. Nothing else would: the mats advance
    // when a match ends, and none of them is holding one.
    if (mode === 'live' && ev.mode !== 'live' && ev.status === 'live') {
      for (const mat of await tx.select({ id: mats.id }).from(mats).where(eq(mats.eventId, eventId)).all()) await advanceMat(tx, mat.id)
    }
    if (status === 'live') {
      await startEvent(tx, eventId)
      await audit('start', { mode: mode ?? ev.mode })
    }
    if (status === 'done') {
      if (ev.status !== 'live') throw new MatchStateError('only a live event can finish')
      await tx.update(events).set({ status: 'done' }).where(eq(events.id, eventId)).run()
      await audit('finish', {})
    }
    await bumpVersion(tx, eventId)
  })
  return c.json(await eventDetail(db, eventId))
})

eventRoutes.delete('/events/:eventId', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  if (ev.status !== 'setup') return errorJson(c, 409, 'match_state', 'only an event in setup can be deleted')
  // The audit row outlives the event, which is the point of a table with no foreign keys.
  await db.transaction(async tx => {
    await tx.delete(events).where(eq(events.id, eventId)).run()
    await recordAudit(tx, { eventId, actor: 'admin', action: 'delete', detail: { name: ev.name, date: ev.date } })
  })
  return c.body(null, 204)
})

eventRoutes.patch('/events/:eventId/teams/:teamId', requireAdmin, validate('json', teamSchema.partial()), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const teamId = Number(c.req.param('teamId'))
  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get()
  if (!team || team.eventId !== eventId) return errorJson(c, 404, 'not_found', 'team not found')
  const fields = c.req.valid('json')
  await db.transaction(async tx => {
    if (Object.keys(fields).length > 0) await tx.update(teams).set(fields).where(eq(teams.id, teamId)).run()
    await recordAudit(tx, {
      eventId, actor: 'admin', action: 'team_edit',
      detail: { teamId, before: { name: team.name, color: team.color }, after: { name: fields.name ?? team.name, color: fields.color ?? team.color } },
    })
    await bumpVersion(tx, eventId)
  })
  return c.json(await eventDetail(db, eventId))
})

eventRoutes.get('/events/:eventId/connect', requireAdmin, async c => {
  const ctx = c.get('ctx')
  const ev = await ctx.db.select().from(events).where(eq(events.id, Number(c.req.param('eventId')))).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  // Mirrors /api/lan: in cloud mode the QR code and the typed address have to point at the
  // deployed origin, not at the container's own private interface.
  return c.json({ url: ctx.publicUrl ?? `http://${lanIp()}:${ctx.port}`, matCode: ev.matCode })
})
