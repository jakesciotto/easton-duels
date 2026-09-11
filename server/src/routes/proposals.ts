import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm'
import type { Env } from '../context.js'
import type { DbLike } from '../db/client.js'
import { events, athletes, rulesets, matches, proposals, type ProposalRow } from '../db/schema.js'
import { validate } from '../lib/validate.js'
import { errorJson, requireAdmin } from '../auth/middleware.js'
import { assertNotCertified } from '../audit/certify.js'
import { createMatch } from '../match/create.js'
import { resolvePair } from '../match/pairs.js'
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
const confirm = (db: DbLike, row: ProposalRow, rulesetId: number) =>
  createMatch(
    db,
    { eventId: row.eventId, athleteAId: row.athleteAId, athleteBId: row.athleteBId, rulesetId, source: 'proposed' },
    async tx => { await tx.delete(proposals).where(eq(proposals.id, row.id)).run() },
  )

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
  // once the one before it has been placed.
  let created = 0
  for (const row of rows) {
    if ((await confirm(db, row, ruleset.id)).ok) created++
  }
  return c.json({ created }, 201)
})

proposalRoutes.post('/proposals/:proposalId/confirm', requireAdmin, async c => {
  const { db } = c.get('ctx')
  const row = await db.select().from(proposals).where(eq(proposals.id, Number(c.req.param('proposalId')))).get()
  if (!row) return errorJson(c, 404, 'not_found', 'proposal not found')
  await assertNotCertified(db, row.eventId)
  const ruleset = await firstRuleset(db, row.eventId)
  if (!ruleset) return errorJson(c, 409, 'match_state', 'event needs a ruleset')
  const result = await confirm(db, row, ruleset.id)
  if (!result.ok) return errorJson(c, 422, 'validation', result.message)
  return c.json({ match: result.match }, 201)
})

proposalRoutes.patch('/proposals/:proposalId', requireAdmin, validate('json', swapSchema), async c => {
  const { db } = c.get('ctx')
  const row = await db.select().from(proposals).where(eq(proposals.id, Number(c.req.param('proposalId')))).get()
  if (!row) return errorJson(c, 404, 'not_found', 'proposal not found')
  await assertNotCertified(db, row.eventId)
  const body = c.req.valid('json')
  const incoming = [body.athleteAId, body.athleteBId].filter((id): id is number => id !== undefined)
  // Only the kid coming in has to be free: the one staying was already in this draft, and
  // refusing on their account would strand a draft the organizer is trying to fix.
  const busy = await db.select({ id: matches.id }).from(matches).where(and(
    eq(matches.eventId, row.eventId),
    eq(matches.status, 'pending'),
    or(inArray(matches.athleteAId, incoming), inArray(matches.athleteBId, incoming)),
  )).get()
  if (busy) return errorJson(c, 409, 'match_state', 'already has a match')

  const pair = await resolvePair(db, row.eventId, body.athleteAId ?? row.athleteAId, body.athleteBId ?? row.athleteBId)
  if (typeof pair === 'string') return errorJson(c, 422, 'validation', pair)
  const sides = await db.select().from(athletes)
    .where(and(eq(athletes.eventId, row.eventId), inArray(athletes.id, [pair.a, pair.b]))).all()
  const a = sides.find(k => k.id === pair.a)!
  const b = sides.find(k => k.id === pair.b)!

  const clash = await db.select({ id: proposals.id }).from(proposals).where(and(
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
