import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { events, athletes, rulesets, proposals, type ProposalRow } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { assertNotCertified } from '../audit/certify.js'
import { createMatch } from '../match/create.js'
import { busyAthlete, resolvePair } from '../match/pairs.js'
import { loadProposal, loadProposals, pairCost, pairWarnings, pairWhy, proposeMatches } from '../matchmaker/propose.js'

const swapSchema = z.object({
  athleteAId: z.number().int().optional(),
  athleteBId: z.number().int().optional(),
}).refine(b => b.athleteAId !== undefined || b.athleteBId !== undefined, { message: 'name the kid to swap in' })

const eventExists = async (db: DbLike, eventId: number) =>
  Boolean(await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get())

const firstRuleset = (db: DbLike, eventId: number) =>
  db.select({ id: rulesets.id }).from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).get()

// A confirmed draft becomes a match on the same path the Add match dialog uses, and stops
// being a draft in the same transaction.
//
// The draft was written against a pool that has moved on since. A kid the organizer has
// given a match by hand in the meantime is spoken for, and the server is the one choosing
// this pair, so it refuses rather than warns. The check sits inside the insert's
// transaction so two confirms racing over the same kid cannot both pass it.
const confirm = (db: DbLike, row: ProposalRow, rulesetId: number) =>
  createMatch(
    db,
    { eventId: row.eventId, athleteAId: row.athleteAId, athleteBId: row.athleteBId, rulesetId, source: 'proposed' },
    {
      guard: async tx => {
        const busy = await busyAthlete(tx, row.eventId, [row.athleteAId, row.athleteBId])
        return busy ? `${busy.firstName} ${busy.lastName} already has a match` : null
      },
      also: async tx => { await tx.delete(proposals).where(eq(proposals.id, row.id)).run() },
    },
  )

const refuse = (c: Parameters<typeof errorJson>[0], r: { code: 'validation' | 'match_state'; message: string }) =>
  errorJson(c, r.code === 'match_state' ? 409 : 422, r.code, r.message)

export const proposalRoutes = new Hono<Env>()

proposalRoutes.post('/events/:eventId/proposals', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  await assertNotCertified(db, eventId)
  return c.json(await proposeMatches(db, eventId))
})

proposalRoutes.get('/events/:eventId/proposals', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await eventExists(db, eventId)) return errorJson(c, 404, 'not_found', 'event not found')
  return c.json(await loadProposals(db, eventId))
})

proposalRoutes.post('/events/:eventId/proposals/confirm-all', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const eventId = Number(c.req.param('eventId'))
  if (!await eventExists(db, eventId)) return errorJson(c, 404, 'not_found', 'event not found')
  await assertNotCertified(db, eventId)
  const ruleset = await firstRuleset(db, eventId)
  if (!ruleset) return errorJson(c, 409, 'match_state', 'event needs a ruleset')
  const rows = await db.select().from(proposals).where(eq(proposals.eventId, eventId))
    .orderBy(asc(proposals.cost), asc(proposals.id)).all()
  // Closest first, one match at a time, so each match lands on the mat that is emptiest
  // once the one before it has been placed. A draft this cannot confirm stays a draft, so
  // the organizer can swap or remove it; `skipped` is how many the panel still holds.
  let created = 0
  for (const row of rows) {
    if ((await confirm(db, row, ruleset.id)).ok) created++
  }
  return c.json({ created, skipped: rows.length - created }, 201)
})

proposalRoutes.post('/proposals/:proposalId/confirm', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const row = await db.select().from(proposals).where(eq(proposals.id, Number(c.req.param('proposalId')))).get()
  if (!row) return errorJson(c, 404, 'not_found', 'proposal not found')
  await assertNotCertified(db, row.eventId)
  const ruleset = await firstRuleset(db, row.eventId)
  if (!ruleset) return errorJson(c, 409, 'match_state', 'event needs a ruleset')
  const result = await confirm(db, row, ruleset.id)
  if (!result.ok) return refuse(c, result)
  return c.json({ match: result.match }, 201)
})

proposalRoutes.patch('/proposals/:proposalId', requireAdmin, validate('json', swapSchema), async c => {
  const { db } = c.get('ctx')
  const row = await db.select().from(proposals).where(eq(proposals.id, Number(c.req.param('proposalId')))).get()
  if (!row) return errorJson(c, 404, 'not_found', 'proposal not found')
  await assertNotCertified(db, row.eventId)
  const body = c.req.valid('json')
  // Only a kid coming in has to be free. The ones already in this draft are not new, and
  // refusing on their account would strand a draft the organizer is trying to fix.
  const incoming = [body.athleteAId, body.athleteBId]
    .filter((id): id is number => id !== undefined && id !== row.athleteAId && id !== row.athleteBId)
  if (await busyAthlete(db, row.eventId, incoming)) return errorJson(c, 409, 'match_state', 'already has a match')

  const pair = await resolvePair(db, row.eventId, body.athleteAId ?? row.athleteAId, body.athleteBId ?? row.athleteBId)
  if (typeof pair === 'string') return errorJson(c, 422, 'validation', pair)
  const sides = await db.select().from(athletes)
    .where(and(eq(athletes.eventId, row.eventId), inArray(athletes.id, [pair.a, pair.b]))).all()
  const a = sides.find(k => k.id === pair.a)!
  const b = sides.find(k => k.id === pair.b)!

  // The kid coming in can only be in one draft, so the one they are leaving goes, and the
  // console is told which row vanished from under it.
  const clash = incoming.length === 0 ? [] : await db.select({ id: proposals.id }).from(proposals).where(and(
    eq(proposals.eventId, row.eventId),
    ne(proposals.id, row.id),
    or(inArray(proposals.athleteAId, incoming), inArray(proposals.athleteBId, incoming)),
  )).all()
  const removed = clash.map(p => p.id)
  await db.transaction(async tx => {
    if (removed.length > 0) await tx.delete(proposals).where(inArray(proposals.id, removed)).run()
    await tx.update(proposals)
      .set({ athleteAId: pair.a, athleteBId: pair.b, cost: pairCost(a, b), why: pairWhy(a, b) })
      .where(eq(proposals.id, row.id)).run()
  })
  return c.json({
    proposal: await loadProposal(db, row.id),
    removed,
    warnings: await pairWarnings(db, row.eventId, pair.a, pair.b),
  })
})

proposalRoutes.delete('/proposals/:proposalId', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const row = await db.select().from(proposals).where(eq(proposals.id, Number(c.req.param('proposalId')))).get()
  if (!row) return errorJson(c, 404, 'not_found', 'proposal not found')
  await assertNotCertified(db, row.eventId)
  await db.delete(proposals).where(eq(proposals.id, row.id)).run()
  return c.body(null, 204)
})
