import { and, asc, eq, inArray, or } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, matches, proposals, type AthleteRow, type ProposalRow } from '../db/schema.js'
import { MatchStateError } from '../match/events.js'
import { recordAudit } from '../audit/log.js'
import { beltDistance } from './cost.js'
import { classGap, weightClass } from '../shared/weight-class.js'
import type { Proposal, ProposalSide } from '../shared/types.js'

// Weight class first, then age: a class is worth five years of age, and belt and rating
// only settle ties between pairs the first two already agree on.
const CLASS_WEIGHT = 10
const AGE_WEIGHT = 2
const BELT_WEIGHT = 0.5
const ERP_WEIGHT = 0.1

// A pair further apart than this is not offered at all. Past two classes the organizer
// has to ask for the match by hand, and the Add match dialog warns when they do.
export const MAX_CLASS_GAP = 2

// What a hand-designed pair is warned about. Neither ever blocks a write.
export const WARN_CLASS_GAP = 2
export const WARN_AGE_GAP = 3
export const ALREADY_MET = 'Already met'

export interface PairSide {
  id: number
  age: number | null
  weightLbs: number | null
  belt: string | null
  erp: number | null
}

const ageGapOf = (a: PairSide, b: PairSide) => a.age !== null && b.age !== null ? Math.abs(a.age - b.age) : null
const classGapOf = (a: PairSide, b: PairSide) => a.weightLbs !== null && b.weightLbs !== null ? classGap(a.weightLbs, b.weightLbs) : null

/**
 * How far apart a pair is, low is close. A kid missing an age or a weight contributes no
 * gap on that axis rather than an invented one: the proposer never sees such a kid, but a
 * swap can put one in a proposal by hand.
 */
export function pairCost(a: PairSide, b: PairSide): number {
  const erpGap = a.erp !== null && b.erp !== null ? Math.abs(a.erp - b.erp) : 0
  return CLASS_WEIGHT * (classGapOf(a, b) ?? 0)
    + AGE_WEIGHT * (ageGapOf(a, b) ?? 0)
    + BELT_WEIGHT * beltDistance(a.belt, b.belt)
    + ERP_WEIGHT * erpGap
}

/** The one line the console prints between the two kids. */
export function pairWhy(a: PairSide, b: PairSide): string {
  const parts: string[] = []
  const classes = classGapOf(a, b)
  if (classes !== null) parts.push(classes === 0 ? 'same class' : classes === 1 ? '1 class apart' : `${classes} classes apart`)
  const years = ageGapOf(a, b)
  if (years !== null) parts.push(years === 0 ? 'same age' : years === 1 ? '1 year apart' : `${years} years apart`)
  return parts.join(', ') || 'missing age or weight'
}

/**
 * What a person is told about a pair they picked themselves. The server never refuses on
 * these: the organizer knows something the roster does not, and the warning is there so
 * the choice is deliberate rather than accidental. `exceptMatchId` is the match being
 * edited, which would otherwise report itself as the earlier meeting.
 */
export async function pairWarnings(
  db: DbLike, eventId: number, aId: number, bId: number, opts: { exceptMatchId?: number } = {},
): Promise<string[]> {
  const rows = await db.select().from(athletes)
    .where(and(eq(athletes.eventId, eventId), inArray(athletes.id, [aId, bId]))).all()
  const a = rows.find(r => r.id === aId)
  const b = rows.find(r => r.id === bId)
  if (!a || !b) return []
  const out: string[] = []
  const classes = classGapOf(a, b)
  if (classes !== null && classes > WARN_CLASS_GAP) out.push(`${classes} weight classes apart`)
  const years = ageGapOf(a, b)
  if (years !== null && years > WARN_AGE_GAP) out.push(`${years} years apart`)
  const met = await db.select({ id: matches.id }).from(matches).where(and(
    eq(matches.eventId, eventId),
    or(
      and(eq(matches.athleteAId, aId), eq(matches.athleteBId, bId)),
      and(eq(matches.athleteAId, bId), eq(matches.athleteBId, aId)),
    ),
  )).all()
  if (met.some(m => m.id !== opts.exceptMatchId)) out.push(ALREADY_MET)
  return out
}

export function proposalSide(a: AthleteRow): ProposalSide {
  return {
    athleteId: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    teamId: a.teamId as number,
    age: a.age,
    weightLbs: a.weightLbs,
    weightClass: a.weightLbs === null ? null : weightClass(a.weightLbs).label,
    belt: a.belt,
    erp: a.erp,
  }
}

function serialize(row: ProposalRow, byId: Map<number, AthleteRow>): Proposal | null {
  const a = byId.get(row.athleteAId)
  const b = byId.get(row.athleteBId)
  // A kid taken off their team after the draft was made leaves a row nothing can confirm.
  // It is left in the table for the next propose to replace rather than written to here.
  if (!a || !b || a.teamId === null || b.teamId === null) return null
  return { id: row.id, eventId: row.eventId, cost: row.cost, why: row.why, a: proposalSide(a), b: proposalSide(b) }
}

async function athletesById(db: DbLike, eventId: number): Promise<Map<number, AthleteRow>> {
  const rows = await db.select().from(athletes).where(eq(athletes.eventId, eventId)).all()
  return new Map(rows.map(a => [a.id, a]))
}

/** Cost order, which is the order Confirm all works through. */
export async function loadProposals(db: DbLike, eventId: number): Promise<Proposal[]> {
  const rows = await db.select().from(proposals).where(eq(proposals.eventId, eventId))
    .orderBy(asc(proposals.cost), asc(proposals.id)).all()
  const byId = await athletesById(db, eventId)
  return rows.map(r => serialize(r, byId)).filter((p): p is Proposal => p !== null)
}

export async function loadProposal(db: DbLike, proposalId: number): Promise<Proposal | null> {
  const row = await db.select().from(proposals).where(eq(proposals.id, proposalId)).get()
  if (!row) return null
  return serialize(row, await athletesById(db, row.eventId))
}

const pairKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`
const genderKey = (g: string) => g.trim().toLowerCase().charAt(0)

/**
 * Every cross-team pair the event could still run, closest first, taken greedily so each
 * kid appears once. Deterministic: the sort falls through to the athlete ids, so the same
 * roster proposes the same rows every time.
 *
 * One transaction: the event's drafts are replaced whole, because a proposal only means
 * anything against the pool as it stands now.
 */
export async function proposeMatches(db: DbLike, eventId: number): Promise<Proposal[]> {
  return db.transaction(async tx => {
    const ev = await tx.select().from(events).where(eq(events.id, eventId)).get()
    if (!ev) throw new MatchStateError('event not found')
    const teamRows = await tx.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all()
    const positionOf = new Map(teamRows.map(t => [t.id, t.position]))
    const roster = await tx.select().from(athletes).where(eq(athletes.eventId, eventId)).all()
    const matchRows = await tx.select({ a: matches.athleteAId, b: matches.athleteBId, status: matches.status })
      .from(matches).where(eq(matches.eventId, eventId)).all()
    // A kid with an unfought match is spoken for. One whose matches have all settled is
    // free again, but never against the same opponent twice.
    const busy = new Set(matchRows.filter(m => m.status === 'pending').flatMap(m => [m.a, m.b]))
    const met = new Set(matchRows.map(m => pairKey(m.a, m.b)))

    const free = roster.filter(k =>
      k.teamId !== null && positionOf.has(k.teamId) && k.age !== null && k.weightLbs !== null && !busy.has(k.id))
    const lighterOf = (x: AthleteRow, y: AthleteRow) => Math.min(weightClass(x.weightLbs!).index, weightClass(y.weightLbs!).index)

    type Candidate = { a: AthleteRow; b: AthleteRow; cost: number; why: string; lighter: number }
    const candidates: Candidate[] = []
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const x = free[i]
        const y = free[j]
        if (x.teamId === y.teamId) continue
        if (classGap(x.weightLbs!, y.weightLbs!) > MAX_CLASS_GAP) continue
        if (ev.sameGender && x.gender && y.gender && genderKey(x.gender) !== genderKey(y.gender)) continue
        if (met.has(pairKey(x.id, y.id))) continue
        const [a, b] = positionOf.get(x.teamId!)! < positionOf.get(y.teamId!)! ? [x, y] : [y, x]
        candidates.push({ a, b, cost: pairCost(a, b), why: pairWhy(a, b), lighter: lighterOf(a, b) })
      }
    }
    candidates.sort((p, q) => p.cost - q.cost || p.lighter - q.lighter || p.a.id - q.a.id || p.b.id - q.b.id)

    const taken = new Set<number>()
    const chosen: Candidate[] = []
    for (const c of candidates) {
      if (taken.has(c.a.id) || taken.has(c.b.id)) continue
      taken.add(c.a.id)
      taken.add(c.b.id)
      chosen.push(c)
    }

    await tx.delete(proposals).where(eq(proposals.eventId, eventId)).run()
    const at = new Date().toISOString()
    const inserted = chosen.length === 0 ? [] : await tx.insert(proposals).values(chosen.map(c => ({
      eventId, athleteAId: c.a.id, athleteBId: c.b.id, cost: c.cost, why: c.why, createdAt: at,
    }))).returning().all()
    await recordAudit(tx, {
      eventId, actor: 'admin', action: 'propose',
      detail: { count: inserted.length, unmatched: free.length - taken.size },
    })
    const byId = new Map(roster.map(a => [a.id, a]))
    return inserted.map(r => serialize(r, byId)).filter((p): p is Proposal => p !== null)
  })
}
