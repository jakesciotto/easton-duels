import type { EventContact, EventMode, EventStatus, MatchStatus, RulesetAction, RulesetTerminal, TeamColor, WinType } from '@shared/types'

// The sync answers one shape, and the two screens that print it read it from here rather
// than each reaching into the server's own module.
export type { SyncReport, SyncSuggestion } from '@shared/types'

export interface EventRow {
  id: number
  name: string
  date: string
  matCount: number
  matCode: string
  status: EventStatus
  mode: EventMode
  sameGender: boolean
  createdAt: string
  /**
   * 6.4's escalation contact. Optional because the two endpoints that serve an event row
   * carry different halves of it: the list serves the raw columns and the detail adds the
   * joined `contact`, which is null unless both halves are filled. A caller reads whichever
   * one it has and prints nothing when it has neither.
   */
  contactName?: string | null
  contactPhone?: string | null
  contact?: EventContact | null
  /** When an admin signed the record off. Null on every event that is not certified. */
  certifiedAt?: string | null
  /** G24: the board's far setting. Null until an admin sets one, and the board reads 1.0. */
  far?: number | null
  /**
   * The locations an older sync stored. The sync searches every location now, so nothing
   * reads this; it is declared because the detail endpoint still carries the column until
   * the cleanup that drops it. Optional for the same reason as the contact halves above:
   * the list endpoint serves the raw columns and only the detail carries this one.
   */
  wlLocations?: string[] | null
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
  /** WellnessLiving's promotion date for the belt the row carries. */
  promotedAt: string | null
  /** When a sync last touched this row. Null until one has. */
  syncedAt: string | null
  /** What the last sync changed, field by field. Empty when it changed nothing. */
  syncChanges: Record<string, { from: unknown; to: unknown }> | null
  /** The one near match waiting on a person, and how close it scored. */
  suggestedWlUid: string | null
  suggestedScore: number | null
  /** Candidates a person has already said are not this child. */
  dismissedWlUids: string[]
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
  /** Whether the proposer paired these two or somebody designed the match by hand. */
  source: 'designed' | 'proposed'
  // Derived server side from the latest end event rather than stored on the row, so
  // it is read only here and absent on any row this client has built itself.
  endedAt?: string | null
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
/**
 * A draft pairing, and the standing of one team. Both are mirrored here for the same
 * reason `RosterCandidate` is: the screens that print them read one shape from this
 * module rather than each reaching into the server's own.
 */
export interface ProposalSide {
  athleteId: number
  firstName: string
  lastName: string
  teamId: number
  age: number | null
  weightLbs: number | null
  weightClass: string | null
  belt: string | null
  erp: number | null
}
export interface Proposal { id: number; eventId: number; cost: number; why: string; a: ProposalSide; b: ProposalSide }
export interface LeaderboardRow { teamId: number; rank: number; wins: number; points: number }

export interface ManualKid {
  firstName: string
  lastName: string
  age?: number | null
  weightLbs?: number | null
  belt?: string | null
  gender?: string | null
  teamId?: number | null
}
