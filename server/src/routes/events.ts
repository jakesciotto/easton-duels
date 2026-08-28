import { Hono } from 'hono'
import { z } from 'zod'
import { asc, desc, eq } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, rulesets, mats, matches } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { lanIp } from '../lib/lanIp.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { randomMatCode } from '../auth/pin.js'
import { startEvent } from '../match/mats.js'
import { MatchStateError } from '../match/events.js'
import { DEFAULT_ACTIONS, DEFAULT_TERMINALS, DEFAULT_LENGTH_SEC, TEAM_COLOR_KEYS, type TeamColor } from '../shared/types.js'

const colorSchema = z.enum(TEAM_COLOR_KEYS as [TeamColor, ...TeamColor[]])
export const teamSchema = z.object({ name: z.string().trim().min(1).max(40), color: colorSchema })
const maxAgeGap = z.number().int().min(0).max(10)
const maxWeightGap = z.number().int().min(0).max(100)
const sameGender = z.boolean()

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  matCount: z.number().int().min(1).max(8),
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
  maxAgeGap: maxAgeGap.optional(),
  maxWeightGap: maxWeightGap.optional(),
  sameGender: sameGender.optional(),
})

export function eventDetail(db: DbLike, eventId: number) {
  const ev = db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return null
  return {
    event: ev,
    teams: db.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all(),
    athletes: db.select().from(athletes).where(eq(athletes.eventId, eventId)).orderBy(asc(athletes.lastName), asc(athletes.firstName)).all(),
    rulesets: db.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).all(),
    mats: db.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all(),
    matches: db.select().from(matches).where(eq(matches.eventId, eventId)).orderBy(asc(matches.orderIndex), asc(matches.id)).all(),
  }
}

function setMatCount(tx: DbLike, eventId: number, matCount: number) {
  const rows = tx.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all()
  if (matCount > rows.length) {
    tx.insert(mats).values(Array.from({ length: matCount - rows.length }, (_, i) => ({ eventId, number: rows.length + i + 1 }))).run()
  } else {
    for (const mat of rows.filter(m => m.number > matCount)) {
      const used = tx.select({ id: matches.id }).from(matches).where(eq(matches.matId, mat.id)).get()
      if (used) throw new MatchStateError(`mat ${mat.number} has matches; move them first`)
      tx.delete(mats).where(eq(mats.id, mat.id)).run()
    }
  }
  tx.update(events).set({ matCount }).where(eq(events.id, eventId)).run()
}

export const eventRoutes = new Hono<Env>()

eventRoutes.get('/events', requireAdmin, c => {
  const db = c.get('ctx').db
  const rows = db.select().from(events).orderBy(desc(events.date), desc(events.id)).all()
  const teamRows = db.select().from(teams).orderBy(asc(teams.position)).all()
  return c.json(rows.map(ev => ({ ...ev, teams: teamRows.filter(t => t.eventId === ev.id) })))
})

eventRoutes.post('/events', requireAdmin, validate('json', createEventSchema), c => {
  const { db, hub } = c.get('ctx')
  const body = c.req.valid('json')
  const detail = db.transaction(tx => {
    const ev = tx.insert(events).values({
      name: body.name, date: body.date, matCount: body.matCount, matCode: randomMatCode(),
      maxAgeGap: body.maxAgeGap ?? 1, maxWeightGap: body.maxWeightGap ?? 10, sameGender: body.sameGender ?? false,
      createdAt: new Date().toISOString(),
    }).returning().get()
    tx.insert(teams).values(body.teams.map((t, i) => ({ eventId: ev.id, name: t.name, color: t.color, position: i }))).run()
    tx.insert(mats).values(Array.from({ length: body.matCount }, (_, i) => ({ eventId: ev.id, number: i + 1 }))).run()
    tx.insert(rulesets).values({ eventId: ev.id, name: 'Default', defaultLengthSec: DEFAULT_LENGTH_SEC, actions: DEFAULT_ACTIONS, terminals: DEFAULT_TERMINALS }).run()
    return eventDetail(tx, ev.id)
  })
  hub.broadcast(detail!.event.id)
  return c.json(detail, 201)
})

eventRoutes.get('/events/:eventId', requireAdmin, c => {
  const detail = eventDetail(c.get('ctx').db, Number(c.req.param('eventId')))
  if (!detail) return errorJson(c, 404, 'not_found', 'event not found')
  return c.json(detail)
})

eventRoutes.patch('/events/:eventId', requireAdmin, validate('json', patchEventSchema), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  const { status, matCount, ...fields } = c.req.valid('json')
  db.transaction(tx => {
    if (Object.keys(fields).length > 0) tx.update(events).set(fields).where(eq(events.id, eventId)).run()
    if (matCount !== undefined && matCount !== ev.matCount) setMatCount(tx, eventId, matCount)
    if (status === 'live') startEvent(tx, eventId)
    if (status === 'done') {
      if (ev.status !== 'live') throw new MatchStateError('only a live event can finish')
      tx.update(events).set({ status: 'done' }).where(eq(events.id, eventId)).run()
    }
  })
  hub.broadcast(eventId)
  return c.json(eventDetail(db, eventId))
})

eventRoutes.delete('/events/:eventId', requireAdmin, c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const ev = db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  if (ev.status !== 'setup') return errorJson(c, 409, 'match_state', 'only an event in setup can be deleted')
  db.delete(events).where(eq(events.id, eventId)).run()
  return c.body(null, 204)
})

eventRoutes.patch('/events/:eventId/teams/:teamId', requireAdmin, validate('json', teamSchema.partial()), c => {
  const { db, hub } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  const teamId = Number(c.req.param('teamId'))
  const team = db.select().from(teams).where(eq(teams.id, teamId)).get()
  if (!team || team.eventId !== eventId) return errorJson(c, 404, 'not_found', 'team not found')
  const fields = c.req.valid('json')
  if (Object.keys(fields).length > 0) db.update(teams).set(fields).where(eq(teams.id, teamId)).run()
  hub.broadcast(eventId)
  return c.json(eventDetail(db, eventId))
})

eventRoutes.get('/events/:eventId/connect', requireAdmin, c => {
  const ctx = c.get('ctx')
  const ev = ctx.db.select().from(events).where(eq(events.id, Number(c.req.param('eventId')))).get()
  if (!ev) return errorJson(c, 404, 'not_found', 'event not found')
  return c.json({ url: `http://${lanIp()}:${ctx.port}`, matCode: ev.matCode })
})
