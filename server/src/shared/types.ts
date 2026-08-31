export type WinType = 'submission' | 'points' | 'decision'
export type MatchStatus = 'pending' | 'live' | 'done'
export type EventStatus = 'setup' | 'live' | 'done'
export type MatchEventType = 'score' | 'set_score' | 'clock_start' | 'clock_pause' | 'terminal' | 'end' | 'admin'

export interface RulesetAction { key: string; label: string; points: number }
export interface RulesetTerminal { key: string; label: string; winType: WinType }

export type MatchEventPayload =
  | { kind: 'end'; winnerAthleteId: number; winType: WinType }
  | { kind: 'reopen' }
  | { kind: 'edit_result'; winnerAthleteId: number; winType: WinType }
  | { kind: 'skip' }

export interface ClockState { elapsedMs: number; startedAt: string | null; lengthMs: number }
export interface MatchResult { winnerAthleteId: number; winType: WinType }
export interface PendingTerminal { athleteId: number; actionKey: string }

export interface MatchSide {
  athleteId: number
  name: string
  teamId: number | null
  belt: string | null
  weightLbs: number | null
  score: number
}

export interface MatchView {
  id: number
  orderIndex: number
  matId: number | null
  status: MatchStatus
  rulesetId: number
  lengthSec: number
  why: string | null
  a: MatchSide
  b: MatchSide
  clock: ClockState
  result: MatchResult | null
  pendingTerminal: PendingTerminal | null
  endedAt: string | null
  lastSeq: number
}

export interface TeamView { id: number; name: string; color: TeamColor; position: number; wins: number; points: number }
export interface RulesetView { id: number; name: string; defaultLengthSec: number; actions: RulesetAction[]; terminals: RulesetTerminal[] }
export interface MatView { id: number; number: number; current: MatchView | null; onDeck: MatchView[]; bound: boolean }

export interface Snapshot {
  version: number
  now: string
  event: { id: number; name: string; date: string; status: EventStatus; matCount: number }
  teams: TeamView[]
  rulesets: RulesetView[]
  mats: MatView[]
  matches: MatchView[]
}

export const TEAM_COLORS = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  purple: '#a855f7',
  pink: '#ec4899',
  teal: '#14b8a6',
  orange: '#f97316',
} as const
export type TeamColor = keyof typeof TEAM_COLORS
export const TEAM_COLOR_KEYS = Object.keys(TEAM_COLORS) as TeamColor[]

export const KIDS_BELTS = [
  'white',
  'grey-white', 'grey', 'grey-black',
  'yellow-white', 'yellow', 'yellow-black',
  'orange-white', 'orange', 'orange-black',
  'green-white', 'green', 'green-black',
] as const
export type KidsBelt = typeof KIDS_BELTS[number]

export const DEFAULT_ACTIONS: RulesetAction[] = [
  { key: 'takedown', label: 'Takedown', points: 2 },
  { key: 'sweep', label: 'Sweep', points: 2 },
  { key: 'pass', label: 'Pass', points: 3 },
  { key: 'mount', label: 'Mount', points: 4 },
  { key: 'back', label: 'Back', points: 4 },
  { key: 'nearfall', label: 'Near fall', points: 2 },
  { key: 'penalty', label: 'Penalty', points: -1 },
]
export const DEFAULT_TERMINALS: RulesetTerminal[] = [
  { key: 'submission', label: 'Submission', winType: 'submission' },
  { key: 'pin', label: 'Pin', winType: 'submission' },
]
export const DEFAULT_LENGTH_SEC = 300
