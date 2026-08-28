import { asc, desc, eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { matches, matchEvents, rulesets, type MatchRow, type MatchEventRow, type RulesetRow } from '../db/schema.js'
import { deriveMatch, deriveOutcome } from './derive.js'
import type { MatchResult } from '../shared/types.js'

export class SeqConflict extends Error {
  constructor(public readonly currentSeq: number) {
    super('sequence conflict')
    this.name = 'SeqConflict'
  }
}

export class MatchStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatchStateError'
  }
}

export class DecisionRequired extends Error {
  constructor() {
    super('decision required')
    this.name = 'DecisionRequired'
  }
}

export type ScoringEventType = 'score' | 'clock_start' | 'clock_pause' | 'terminal'

export interface AppendInput {
  id: string
  matchId: number
  type: ScoringEventType
  athleteId?: number
  actionKey?: string
  lastSeq: number
  at?: string
}

export interface EndInput {
  id: string
  matchId: number
  lastSeq: number
  winnerAthleteId?: number
  at?: string
}

export interface AppendResult { duplicate: boolean; match: MatchRow }

type Insert = typeof matchEvents.$inferInsert

export function loadMatch(db: DbLike, matchId: number): MatchRow {
  const row = db.select().from(matches).where(eq(matches.id, matchId)).get()
  if (!row) throw new MatchStateError('match not found')
  return row
}

export function loadEvents(db: DbLike, matchId: number): MatchEventRow[] {
  return db.select().from(matchEvents).where(eq(matchEvents.matchId, matchId)).orderBy(asc(matchEvents.seq)).all()
}

export function loadRuleset(db: DbLike, rulesetId: number): RulesetRow {
  const row = db.select().from(rulesets).where(eq(rulesets.id, rulesetId)).get()
  if (!row) throw new MatchStateError('ruleset not found')
  return row
}

export function recompute(db: DbLike, matchId: number): MatchRow {
  const match = loadMatch(db, matchId)
  const d = deriveMatch(loadEvents(db, matchId), match.athleteAId, match.athleteBId, match.lengthSec * 1000)
  const status = d.result ? 'done' : match.status === 'pending' ? 'pending' : 'live'
  db.update(matches).set({
    pointsA: d.scoreA,
    pointsB: d.scoreB,
    clockElapsedMs: d.clockElapsedMs,
    clockStartedAt: d.clockStartedAt,
    pendingTerminalAthleteId: d.pendingTerminal?.athleteId ?? null,
    pendingTerminalKey: d.pendingTerminal?.actionKey ?? null,
    lastSeq: d.lastSeq,
    status,
    winnerAthleteId: d.result?.winnerAthleteId ?? null,
    winType: d.result?.winType ?? null,
  }).where(eq(matches.id, matchId)).run()
  return loadMatch(db, matchId)
}

function assertAthlete(match: MatchRow, athleteId: number | undefined): number {
  if (athleteId !== match.athleteAId && athleteId !== match.athleteBId) throw new MatchStateError('athlete not in match')
  return athleteId
}

function guard(db: DbLike, input: { id: string; matchId: number; lastSeq: number }): { duplicate: AppendResult } | { match: MatchRow } {
  const existing = db.select().from(matchEvents).where(eq(matchEvents.id, input.id)).get()
  if (existing) return { duplicate: { duplicate: true, match: loadMatch(db, existing.matchId) } }
  const match = loadMatch(db, input.matchId)
  if (match.status !== 'live') throw new MatchStateError(`match is ${match.status}`)
  if (match.lastSeq !== input.lastSeq) throw new SeqConflict(match.lastSeq)
  return { match }
}

export function appendMatchEvent(db: DbLike, input: AppendInput): AppendResult {
  return db.transaction(tx => {
    const g = guard(tx, input)
    if ('duplicate' in g) return g.duplicate
    const match = g.match
    const at = input.at ?? new Date().toISOString()
    let seq = match.lastSeq
    const rows: Insert[] = []
    switch (input.type) {
      case 'score': {
        const action = loadRuleset(tx, match.rulesetId).actions.find(a => a.key === input.actionKey)
        if (!action) throw new MatchStateError('unknown action')
        const athleteId = assertAthlete(match, input.athleteId)
        rows.push({ id: input.id, matchId: match.id, seq: ++seq, type: 'score', athleteId, actionKey: action.key, points: action.points, at })
        break
      }
      case 'terminal': {
        const terminal = loadRuleset(tx, match.rulesetId).terminals.find(t => t.key === input.actionKey)
        if (!terminal) throw new MatchStateError('unknown terminal')
        const athleteId = assertAthlete(match, input.athleteId)
        if (match.clockStartedAt) rows.push({ id: `${input.id}:pause`, matchId: match.id, seq: ++seq, type: 'clock_pause', at })
        rows.push({ id: input.id, matchId: match.id, seq: ++seq, type: 'terminal', athleteId, actionKey: terminal.key, at })
        break
      }
      case 'clock_start':
        if (match.clockStartedAt) throw new MatchStateError('clock already running')
        if (match.clockElapsedMs >= match.lengthSec * 1000) throw new MatchStateError('time is up')
        if (match.pendingTerminalKey) throw new MatchStateError('terminal pending')
        rows.push({ id: input.id, matchId: match.id, seq: ++seq, type: 'clock_start', at })
        break
      case 'clock_pause':
        if (!match.clockStartedAt) throw new MatchStateError('clock not running')
        rows.push({ id: input.id, matchId: match.id, seq: ++seq, type: 'clock_pause', at })
        break
    }
    tx.insert(matchEvents).values(rows).run()
    return { duplicate: false, match: recompute(tx, match.id) }
  })
}

export function endMatch(db: DbLike, input: EndInput): AppendResult {
  return db.transaction(tx => {
    const g = guard(tx, input)
    if ('duplicate' in g) return g.duplicate
    const match = g.match
    const at = input.at ?? new Date().toISOString()
    const d = deriveMatch(loadEvents(tx, match.id), match.athleteAId, match.athleteBId, match.lengthSec * 1000)
    const outcome = deriveOutcome(d, match.athleteAId, match.athleteBId, loadRuleset(tx, match.rulesetId).terminals)
    let result: MatchResult
    if (outcome.kind === 'decided') {
      result = { winnerAthleteId: outcome.winnerAthleteId, winType: outcome.winType }
    } else {
      if (input.winnerAthleteId === undefined) throw new DecisionRequired()
      result = { winnerAthleteId: assertAthlete(match, input.winnerAthleteId), winType: 'decision' }
    }
    let seq = match.lastSeq
    const rows: Insert[] = []
    if (match.clockStartedAt) rows.push({ id: `${input.id}:pause`, matchId: match.id, seq: ++seq, type: 'clock_pause', at })
    rows.push({ id: input.id, matchId: match.id, seq: ++seq, type: 'end', athleteId: result.winnerAthleteId, payload: { kind: 'end', ...result }, at })
    tx.insert(matchEvents).values(rows).run()
    return { duplicate: false, match: recompute(tx, match.id) }
  })
}

export function undoLastMatchEvent(db: DbLike, input: { matchId: number; lastSeq: number }): MatchRow {
  return db.transaction(tx => {
    const match = loadMatch(tx, input.matchId)
    if (match.status !== 'live') throw new MatchStateError(`match is ${match.status}`)
    if (match.lastSeq !== input.lastSeq) throw new SeqConflict(match.lastSeq)
    const last = tx.select().from(matchEvents).where(eq(matchEvents.matchId, match.id)).orderBy(desc(matchEvents.seq)).get()
    if (!last) throw new MatchStateError('nothing to undo')
    if (last.type === 'admin') throw new MatchStateError('cannot undo an admin event')
    tx.delete(matchEvents).where(eq(matchEvents.id, last.id)).run()
    return recompute(tx, match.id)
  })
}
