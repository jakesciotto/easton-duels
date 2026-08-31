import type { EventStatus, MatchStatus, RulesetAction, RulesetTerminal, TeamColor, WinType } from '@shared/types'

export interface EventRow {
  id: number
  name: string
  date: string
  matCount: number
  matCode: string
  status: EventStatus
  maxAgeGap: number
  maxWeightGap: number
  sameGender: boolean
  createdAt: string
}
export interface TeamRow { id: number; eventId: number; name: string; color: TeamColor; position: number }
export interface AthleteRow {
  id: number
  eventId: number
  teamId: number | null
  firstName: string
  lastName: string
  age: number | null
  ageSource: 'manual' | 'leaderboard' | 'wl' | null
  weightLbs: number | null
  weightSource: 'manual' | 'leaderboard' | null
  belt: string | null
  gender: string | null
  source: 'wl' | 'manual'
  wlUid: string | null
  wlLocation: string | null
  leaderboardId: string | null
  erp: number | null
}
export interface RulesetRow { id: number; eventId: number; name: string; defaultLengthSec: number; actions: RulesetAction[]; terminals: RulesetTerminal[] }
export interface MatRow { id: number; eventId: number; number: number; currentMatchId: number | null }
export interface MatchRow {
  id: number
  eventId: number
  matId: number | null
  orderIndex: number
  rulesetId: number
  lengthSec: number
  athleteAId: number
  athleteBId: number
  status: MatchStatus
  winnerAthleteId: number | null
  winType: WinType | null
  pointsA: number
  pointsB: number
  clockElapsedMs: number
  clockStartedAt: string | null
  pendingTerminalAthleteId: number | null
  pendingTerminalKey: string | null
  lastSeq: number
  why: string | null
}
export interface EventDetail { event: EventRow; teams: TeamRow[]; athletes: AthleteRow[]; rulesets: RulesetRow[]; mats: MatRow[]; matches: MatchRow[]; candidateCount: number }
export type EventSummary = EventRow & { teams: TeamRow[] }
export interface RosterCandidate {
  wlUid: string
  firstName: string
  lastName: string
  belt: string | null
  wlLocation: string
  leaderboardId: string | null
  erp: number | null
  age: number | null
  weightLbs: number | null
  gender: string | null
}
export interface ManualKid {
  firstName: string
  lastName: string
  age?: number | null
  weightLbs?: number | null
  belt?: string | null
  gender?: string | null
  teamId?: number | null
}
