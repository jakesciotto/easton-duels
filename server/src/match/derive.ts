import type { MatchEventPayload, MatchEventType, MatchResult, PendingTerminal, RulesetTerminal, WinType } from '../shared/types.js'

export interface MatchEventInput {
  seq: number
  type: MatchEventType
  athleteId: number | null
  actionKey: string | null
  points: number | null
  payload: MatchEventPayload | null
  at: string
}

export interface DerivedMatch {
  scoreA: number
  scoreB: number
  clockElapsedMs: number
  clockStartedAt: string | null
  lastSeq: number
  pendingTerminal: PendingTerminal | null
  result: MatchResult | null
}

export type Outcome =
  | { kind: 'decided'; winnerAthleteId: number; winType: WinType }
  | { kind: 'tie' }

export function deriveMatch(events: MatchEventInput[], athleteAId: number, athleteBId: number, lengthMs: number): DerivedMatch {
  let rawA = 0
  let rawB = 0
  let elapsed = 0
  let startedAt: string | null = null
  let pendingTerminal: PendingTerminal | null = null
  let result: MatchResult | null = null
  let lastSeq = 0

  for (const e of [...events].sort((x, y) => x.seq - y.seq)) {
    lastSeq = e.seq
    switch (e.type) {
      case 'score':
        if (e.athleteId === athleteAId) rawA += e.points ?? 0
        else if (e.athleteId === athleteBId) rawB += e.points ?? 0
        break
      case 'set_score':
        if (e.athleteId === athleteAId) rawA = e.points ?? 0
        else if (e.athleteId === athleteBId) rawB = e.points ?? 0
        break
      case 'clock_start':
        if (startedAt === null && elapsed < lengthMs) startedAt = e.at
        break
      case 'clock_pause':
        if (startedAt !== null) {
          elapsed = Math.min(lengthMs, elapsed + Math.max(0, Date.parse(e.at) - Date.parse(startedAt)))
          startedAt = null
        }
        break
      case 'terminal':
        if (e.athleteId !== null && e.actionKey !== null) pendingTerminal = { athleteId: e.athleteId, actionKey: e.actionKey }
        break
      case 'end':
        if (e.payload?.kind === 'end') result = { winnerAthleteId: e.payload.winnerAthleteId, winType: e.payload.winType }
        break
      case 'admin':
        if (e.payload?.kind === 'reopen') {
          result = null
          pendingTerminal = null
        } else if (e.payload?.kind === 'edit_result') {
          result = { winnerAthleteId: e.payload.winnerAthleteId, winType: e.payload.winType }
        }
        break
    }
  }

  return {
    scoreA: Math.max(0, rawA),
    scoreB: Math.max(0, rawB),
    clockElapsedMs: elapsed,
    clockStartedAt: startedAt,
    lastSeq,
    pendingTerminal,
    result,
  }
}

export function deriveOutcome(d: DerivedMatch, athleteAId: number, athleteBId: number, terminals: RulesetTerminal[]): Outcome {
  if (d.pendingTerminal) {
    const key = d.pendingTerminal.actionKey
    const terminal = terminals.find(x => x.key === key)
    return { kind: 'decided', winnerAthleteId: d.pendingTerminal.athleteId, winType: terminal?.winType ?? 'submission' }
  }
  if (d.scoreA > d.scoreB) return { kind: 'decided', winnerAthleteId: athleteAId, winType: 'points' }
  if (d.scoreB > d.scoreA) return { kind: 'decided', winnerAthleteId: athleteBId, winType: 'points' }
  return { kind: 'tie' }
}
