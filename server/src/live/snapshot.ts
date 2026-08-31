import { asc, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { events, teams, athletes, rulesets, mats, matches, type MatchRow, type AthleteRow } from '../db/schema.js'
import type { Snapshot, MatchView, MatchSide, MatView, TeamView, TeamColor } from '../shared/types.js'
import { MatchStateError, endedAtByMatch } from '../match/events.js'

export interface SnapshotOptions {
  nowMs: number
}

export function toMatchView(m: MatchRow, athleteById: Map<number, AthleteRow>, endedAt: string | null): MatchView {
  const side = (id: number, score: number): MatchSide => {
    const a = athleteById.get(id)
    return {
      athleteId: id,
      name: a ? `${a.firstName} ${a.lastName}` : 'Unknown',
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
    lengthSec: m.lengthSec,
    why: m.why,
    a: side(m.athleteAId, m.pointsA),
    b: side(m.athleteBId, m.pointsB),
    clock: { elapsedMs: m.clockElapsedMs, startedAt: m.clockStartedAt, lengthMs: m.lengthSec * 1000 },
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
  const views = matchRows.map(m => toMatchView(m, athleteById, endedAtById.get(m.id) ?? null))

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
    const onDeck = views.filter(v => v.matId === mat.id && v.status === 'pending' && v.id !== current?.id).slice(0, 2)
    return { id: mat.id, number: mat.number, current, onDeck, bound: mat.bound }
  })
  return {
    version: ev.version,
    now: new Date(opts.nowMs).toISOString(),
    event: { id: ev.id, name: ev.name, date: ev.date, status: ev.status, matCount: ev.matCount },
    teams: teamViews,
    rulesets: rulesetRows.map(r => ({ id: r.id, name: r.name, defaultLengthSec: r.defaultLengthSec, actions: r.actions, terminals: r.terminals })),
    mats: matViews,
    matches: views,
  }
}
