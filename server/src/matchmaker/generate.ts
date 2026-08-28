import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, rulesets, mats, matches, type AthleteRow } from '../db/schema.js'
import { MatchStateError } from '../match/events.js'
import { solveAssignment } from './hungarian.js'
import { pairCost, EXCLUDED } from './cost.js'

export interface GenerateResult { created: number; unpairedA: number[]; unpairedB: number[] }

export function generateMatches(db: DbLike, eventId: number): GenerateResult {
  return db.transaction(tx => {
    const ev = tx.select().from(events).where(eq(events.id, eventId)).get()
    if (!ev) throw new MatchStateError('event not found')
    const teamRows = tx.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all()
    if (teamRows.length !== 2) throw new MatchStateError('event needs two teams')
    const ruleset = tx.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).get()
    if (!ruleset) throw new MatchStateError('event needs a ruleset')
    const all = tx.select().from(athletes).where(eq(athletes.eventId, eventId)).all()
    const A = all.filter(a => a.teamId === teamRows[0].id)
    const B = all.filter(a => a.teamId === teamRows[1].id)

    const stale = tx.select({ id: matches.id }).from(matches)
      .where(and(eq(matches.eventId, eventId), eq(matches.status, 'pending'))).all().map(m => m.id)
    if (stale.length) {
      tx.update(mats).set({ currentMatchId: null }).where(inArray(mats.currentMatchId, stale)).run()
      tx.delete(matches).where(inArray(matches.id, stale)).run()
    }

    const constraints = { maxAgeGap: ev.maxAgeGap, maxWeightGap: ev.maxWeightGap, sameGender: ev.sameGender }
    const costs = A.map(a => B.map(b => pairCost(a, b, constraints)))
    const assignment = solveAssignment(costs.map(row => row.map(x => x.cost)))
    const pairs: { a: AthleteRow; b: AthleteRow; why: string }[] = []
    assignment.forEach((j, i) => {
      if (j >= 0 && costs[i][j].cost < EXCLUDED) pairs.push({ a: A[i], b: B[j], why: costs[i][j].why })
    })
    const avgWeight = (p: { a: AthleteRow; b: AthleteRow }) => ((p.a.weightLbs ?? 0) + (p.b.weightLbs ?? 0)) / 2
    pairs.sort((x, y) => avgWeight(x) - avgWeight(y))

    const matRows = tx.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all()
    const max = tx.select({ m: sql<number>`coalesce(max(${matches.orderIndex}), -1)` }).from(matches).where(eq(matches.eventId, eventId)).get()
    const start = (max?.m ?? -1) + 1
    pairs.forEach((p, i) => {
      tx.insert(matches).values({
        eventId, matId: matRows.length ? matRows[i % matRows.length].id : null, orderIndex: start + i,
        rulesetId: ruleset.id, lengthSec: ruleset.defaultLengthSec, athleteAId: p.a.id, athleteBId: p.b.id, why: p.why,
      }).run()
    })
    const pairedA = new Set(pairs.map(p => p.a.id))
    const pairedB = new Set(pairs.map(p => p.b.id))
    return {
      created: pairs.length,
      unpairedA: A.filter(a => !pairedA.has(a.id)).map(a => a.id),
      unpairedB: B.filter(b => !pairedB.has(b.id)).map(b => b.id),
    }
  })
}
