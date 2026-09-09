import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { auditLog, events, teams, athletes, rulesets, mats, matches, rosterCandidates } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { lanIp } from '../lib/lanIp.js'
import { clientIp, errorJson, requireAdmin } from '../auth/middleware.js'
import { checkLimit, recordFailure } from '../auth/dbRateLimit.js'
import { pinMatches, randomMatCode } from '../auth/pin.js'
import { advanceMat, startEvent } from '../match/mats.js'
import { MatchStateError, bumpVersion, endedAtByMatch } from '../match/events.js'
import { recordAudit, HISTORY_LIMIT } from '../audit/log.js'
import { assertNotCertified } from '../audit/certify.js'
import { eventContact } from '../live/snapshot.js'
import { CORRECTION_REASON_MAX, DEFAULT_ACTIONS, DEFAULT_TERMINALS, DEFAULT_LENGTH_SEC, FAR_MIN, FAR_MAX, TEAM_COLOR_KEYS, type AuditAction, type AuditEntry, type TeamColor } from '../shared/types.js'

const colorSchema = z.enum(TEAM_COLOR_KEYS as [TeamColor, ...TeamColor[]])
export const teamSchema = z.object({ name: z.string().trim().min(1).max(40), color: colorSchema })
// Empty clears the field. A contact with only one half reads as absent everywhere, so
// there is nothing to gain from refusing a half-filled pair at the edge.
const contactName = z.string().trim().max(60)
const contactPhone = z.string().trim().max(30)
const sameGender = z.boolean()

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  matCount: z.number().int().min(1).max(8),
  mode: z.enum(['live', 'entry']).optional(),
  contactName: contactName.optional(),
  contactPhone: contactPhone.optional(),
  teams: z.tuple([teamSchema, teamSchema]),
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
  sameGender: sameGender.optional(),
  far: z.number().min(FAR_MIN).max(FAR_MAX).nullable().optional(),
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
      sameGender: body.sameGender ?? false,
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
  await assertNotCertified(db, eventId)
  const { status, matCount, contactName: name, contactPhone: phone, mode, far, ...rest } = c.req.valid('json')
  // The console sends the whole form back, so most of `rest` usually repeats what is
  // already stored. Only the fields that differ belong in the history: a row saying an
  // event was edited when nothing about it moved is noise in the one place that has to be
  // trustworthy.
  const changed = Object.fromEntries(
    Object.entries(rest).filter(([key, value]) => value !== ev[key as keyof typeof ev]),
  )
  const fields: Partial<typeof events.$inferInsert> = { ...rest }
  if (mode !== undefined) fields.mode = mode
  if (name !== undefined) fields.contactName = blankToNull(name)
  if (phone !== undefined) fields.contactPhone = blankToNull(phone)
  if (far !== undefined) fields.far = far
  // One PATCH can carry several unrelated changes, and the history is read a line at a
  // time, so each concern the body actually changes gets its own row.
  await db.transaction(async tx => {
    const audit = (action: AuditAction, detail: Record<string, unknown>) => recordAudit(tx, { eventId, actor: 'admin', action, detail })
    if (Object.keys(fields).length > 0) await tx.update(events).set(fields).where(eq(events.id, eventId)).run()
    if (matCount !== undefined && matCount !== ev.matCount) {
      await setMatCount(tx, eventId, matCount)
      await audit('mat_count', { from: ev.matCount, to: matCount })
    }
    if (Object.keys(changed).length > 0) await audit('event_edit', changed)
    if (mode !== undefined && mode !== ev.mode) await audit('mode', { from: ev.mode, to: mode })
    if (name !== undefined || phone !== undefined) await audit('contact', { name: fields.contactName ?? ev.contactName, phone: fields.contactPhone ?? ev.contactPhone })
    if (far !== undefined && far !== ev.far) await audit('far', { far })
    // Start skips the mats in entry mode, so an event that switches to the mats halfway
    // through the afternoon has to load them here. Nothing else would: the mats advance
    // when a match ends, and none of them is holding one.
    if (mode === 'live' && ev.mode !== 'live' && ev.status === 'live') {
      for (const mat of await tx.select({ id: mats.id }).from(mats).where(eq(mats.eventId, eventId)).all()) await advanceMat(tx, mat.id, 'admin')
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

const deleteEventSchema = z.object({ pin: z.string().optional() })

eventRoutes.delete('/events/:eventId', requireAdmin, validate('json', deleteEventSchema), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  // Certified is a signature; it stays out of reach until an admin unlocks it, the same
  // as every other write, but the message says what to do rather than only naming the
  // state, because the organizer's next move here is not obvious the way it is elsewhere.
  if (ev.status === 'certified') return errorJson(c, 409, 'match_state', 'unlock the results first')
  const { pin } = c.req.valid('json')
  // Setup is the one status nothing has happened in yet: a plain confirm is enough. Past
  // that, the PIN is asked again so a console left open on a desk cannot erase an
  // afternoon's results with a stray tap.
  if (ev.status !== 'setup') {
    if (pin === undefined) return errorJson(c, 422, 'pin_required', 'This event has results. Enter the PIN to delete it.')
    const refused = await withPin(c, pin)
    if (refused) return refused
  }
  const athleteCount = await db.select({ n: count() }).from(athletes).where(eq(athletes.eventId, eventId)).get()
  const matchRows = await db.select({ status: matches.status }).from(matches).where(eq(matches.eventId, eventId)).all()
  const results = matchRows.filter(m => m.status === 'done').length
  // The audit row outlives the event, which is the point of a table with no foreign keys.
  // The counts are read before the delete because nothing is left to count after it.
  await db.transaction(async tx => {
    await tx.delete(events).where(eq(events.id, eventId)).run()
    await recordAudit(tx, {
      eventId, actor: 'admin', action: 'delete',
      detail: { name: ev.name, date: ev.date, status: ev.status, athletes: athleteCount?.n ?? 0, matches: matchRows.length, results },
    })
  })
  return c.body(null, 204)
})

eventRoutes.patch('/events/:eventId/teams/:teamId', requireAdmin, validate('json', teamSchema.partial()), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const teamId = Number(c.req.param('teamId'))
  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get()
  if (!team || team.eventId !== eventId) return errorJson(c, 404, 'not_found', 'team not found')
  await assertNotCertified(db, eventId)
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

// Certification is the organizer's signature, so it asks for the PIN again rather than
// trusting the token in the browser: the console is left open on a desk all afternoon.
const pinBody = z.object({ pin: z.string() })
const unlockBody = pinBody.extend({ reason: z.string().trim().min(1).max(CORRECTION_REASON_MAX) })

async function withPin(c: Context<Env>, pin: string): Promise<Response | null> {
  const ctx = c.get('ctx')
  const ip = clientIp(c)
  // The window is an hour, so a person told to wait a minute would try again and again
  // and be refused every time. The wait it prints is the one the limiter is actually
  // holding, rounded up to the next whole minute.
  const limit = await checkLimit(ctx.db, 'certify', ip, Date.now())
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSec / 60))
    return errorJson(c, 429, 'rate_limited', `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`)
  }
  if (pinMatches(pin, ctx.adminPin)) return null
  await recordFailure(ctx.db, 'certify', ip, Date.now())
  return errorJson(c, 401, 'bad_pin', 'wrong PIN')
}

eventRoutes.post('/events/:eventId/certify', requireAdmin, validate('json', pinBody), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  const refused = await withPin(c, c.req.valid('json').pin)
  if (refused) return refused
  if (ev.status !== 'done') return errorJson(c, 409, 'match_state', 'only a finished event can be certified')
  const at = new Date().toISOString()
  await db.transaction(async tx => {
    await tx.update(events).set({ status: 'certified', certifiedAt: at }).where(eq(events.id, eventId)).run()
    await recordAudit(tx, { eventId, actor: 'admin', action: 'certify', detail: { certifiedAt: at }, at })
    await bumpVersion(tx, eventId)
  })
  return c.json(await eventDetail(db, eventId))
})

eventRoutes.post('/events/:eventId/uncertify', requireAdmin, validate('json', unlockBody), async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  const body = c.req.valid('json')
  const refused = await withPin(c, body.pin)
  if (refused) return refused
  if (ev.status !== 'certified') return errorJson(c, 409, 'match_state', 'only a certified event can be unlocked')
  await db.transaction(async tx => {
    await tx.update(events).set({ status: 'done', certifiedAt: null }).where(eq(events.id, eventId)).run()
    await recordAudit(tx, { eventId, actor: 'admin', action: 'uncertify', detail: { reason: body.reason, certifiedAt: ev.certifiedAt } })
    await bumpVersion(tx, eventId)
  })
  return c.json(await eventDetail(db, eventId))
})

// The companion to a match's history, for the rows that belong to no match: certify,
// unlock, Start, Finish, the roster and the running order. Rows that name a match are
// left to that match's own history, or a busy afternoon's scoring would push every
// event-level row past the limit. It takes the newest rows rather than the oldest,
// because an event's log only grows and the end of it is what a person is looking at,
// and hands them back in reading order.
eventRoutes.get('/events/:eventId/history', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const rows = await db.select({
    id: auditLog.id, at: auditLog.at, actor: auditLog.actor, action: auditLog.action, detail: auditLog.detail,
  }).from(auditLog).where(and(
    eq(auditLog.eventId, Number(c.req.param('eventId'))),
    isNull(auditLog.matchId),
  )).orderBy(desc(auditLog.id)).limit(HISTORY_LIMIT).all()
  const body: AuditEntry[] = rows.reverse()
  return c.json(body)
})

eventRoutes.get('/events/:eventId/connect', requireAdmin, async c => {
  const ctx = c.get('ctx')
  const ev = await ctx.db.select().from(events).where(eq(events.id, Number(c.req.param('eventId')))).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  // Mirrors /api/lan: in cloud mode the QR code and the typed address have to point at the
  // deployed origin, not at the container's own private interface.
  return c.json({ url: ctx.publicUrl ?? `http://${lanIp()}:${ctx.port}`, matCode: ev.matCode })
})
