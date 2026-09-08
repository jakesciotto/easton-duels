import { asc, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, rulesets, mats, matches, type MatchRow, type AthleteRow, type EventRow } from '../db/schema.js'
import { ON_DECK_DEPTH, type Snapshot, type MatchView, type MatchSide, type MatView, type TeamView, type TeamColor, type EventContact } from '../shared/types.js'
import { MatchStateError, endedAtByMatch } from '../match/events.js'
import { effectiveLengthMs } from '../match/derive.js'
import type { TokenPayload } from '../auth/tokens.js'

/**
 * Which name a view carries. The snapshot is public: the board reads it with no token
 * and the tablets with a mat token, and until 2026-09-08 it served every child's full
 * name to anyone with the URL. Only the console, which holds an admin token, gets the
 * full name. Public is the default so a new caller has to ask for the full form.
 */
export type NameForm = 'full' | 'public'

export function nameFormFor(auth: TokenPayload | null | undefined): NameForm {
  return auth?.role === 'admin' ? 'full' : 'public'
}

/** First name plus last initial: "Mateo R.". A single name stays as it is. */
export function publicName(firstName: string, lastName: string): string {
  const first = firstName.trim()
  const initial = lastName.trim().charAt(0).toUpperCase()
  return initial ? `${first} ${initial}.` : first
}

export interface SnapshotOptions {
  nowMs: number
  names?: NameForm
}

export function eventContact(ev: Pick<EventRow, 'contactName' | 'contactPhone'>): EventContact | null {
  const name = ev.contactName?.trim() ?? ''
  const phone = ev.contactPhone?.trim() ?? ''
  return name && phone ? { name, phone } : null
}

export function toMatchView(m: MatchRow, athleteById: Map<number, AthleteRow>, endedAt: string | null, names: NameForm = 'public'): MatchView {
  const lengthMs = effectiveLengthMs(m)
  const side = (id: number, score: number): MatchSide => {
    const a = athleteById.get(id)
    return {
      athleteId: id,
      name: a ? (names === 'full' ? `${a.firstName} ${a.lastName}` : publicName(a.firstName, a.lastName)) : 'Unknown',
      teamId: a?.teamId ?? null,
      belt: a?.belt ?? null,
      weightLbs: a?.weightLbs ?? null,
      score,
    }
  }
  return {
    id: m.id,
    orderIndex: m.orderIndex,
    matId: m.matId,
    status: m.status,
    rulesetId: m.rulesetId,
    lengthSec: Math.round(lengthMs / 1000),
    why: m.why,
    a: side(m.athleteAId, m.pointsA),
    b: side(m.athleteBId, m.pointsB),
    clock: { elapsedMs: m.clockElapsedMs, startedAt: m.clockStartedAt, lengthMs },
    result: m.winnerAthleteId !== null && m.winType !== null ? { winnerAthleteId: m.winnerAthleteId, winType: m.winType } : null,
    pendingTerminal: m.pendingTerminalAthleteId !== null && m.pendingTerminalKey !== null
      ? { athleteId: m.pendingTerminalAthleteId, actionKey: m.pendingTerminalKey }
      : null,
    endedAt,
    lastSeq: m.lastSeq,
  }
}

export async function buildSnapshot(db: DbLike, eventId: number, opts: SnapshotOptions): Promise<Snapshot> {
  const ev = await db.select().from(events).where(eq(events.id, eventId)).get()
  if (!ev) throw new MatchStateError('event not found')
  const teamRows = await db.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all()
  const athleteRows = await db.select().from(athletes).where(eq(athletes.eventId, eventId)).all()
  const athleteById = new Map(athleteRows.map(a => [a.id, a]))
  const rulesetRows = await db.select().from(rulesets).where(eq(rulesets.eventId, eventId)).orderBy(asc(rulesets.id)).all()
  const matRows = await db.select().from(mats).where(eq(mats.eventId, eventId)).orderBy(asc(mats.number)).all()
  const matchRows = await db.select().from(matches).where(eq(matches.eventId, eventId)).orderBy(asc(matches.orderIndex), asc(matches.id)).all()
  const endedAtById = await endedAtByMatch(db, matchRows.map(m => m.id))
  const views = matchRows.map(m => toMatchView(m, athleteById, endedAtById.get(m.id) ?? null, opts.names ?? 'public'))

  const tally = new Map<number, { wins: number; points: number }>(teamRows.map(t => [t.id, { wins: 0, points: 0 }]))
  const add = (teamId: number | null, wins: number, points: number) => {
    if (teamId === null) return
    const t = tally.get(teamId)
    if (t) {
      t.wins += wins
      t.points += points
    }
  }
  for (const v of views) {
    add(v.a.teamId, 0, v.a.score)
    add(v.b.teamId, 0, v.b.score)
    if (v.status === 'done' && v.result) add(v.result.winnerAthleteId === v.a.athleteId ? v.a.teamId : v.b.teamId, 1, 0)
  }

  const teamViews: TeamView[] = teamRows.map(t => ({
    id: t.id, name: t.name, color: t.color as TeamColor, position: t.position,
    wins: tally.get(t.id)?.wins ?? 0, points: tally.get(t.id)?.points ?? 0,
  }))
  const matViews: MatView[] = matRows.map(mat => {
    const current = mat.currentMatchId !== null ? views.find(v => v.id === mat.currentMatchId) ?? null : null
    const onDeck = views.filter(v => v.matId === mat.id && v.status === 'pending' && v.id !== current?.id).slice(0, ON_DECK_DEPTH)
    return { id: mat.id, number: mat.number, current, onDeck, bound: mat.bound }
  })
  return {
    version: ev.version,
    now: new Date(opts.nowMs).toISOString(),
    event: { id: ev.id, name: ev.name, date: ev.date, status: ev.status, mode: ev.mode, matCount: ev.matCount, contact: eventContact(ev), certifiedAt: ev.certifiedAt },
    teams: teamViews,
    rulesets: rulesetRows.map(r => ({ id: r.id, name: r.name, defaultLengthSec: r.defaultLengthSec, actions: r.actions, terminals: r.terminals })),
    mats: matViews,
    matches: views,
  }
}
