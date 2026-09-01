export type WinType = 'submission' | 'points' | 'decision'
export type MatchStatus = 'pending' | 'live' | 'done'
export type EventStatus = 'setup' | 'live' | 'done'
/**
 * How the event is run. 'entry' means the desk types every result and no tablet scores a
 * mat; 'live' means the mats drive it and the desk corrects. The walkthrough two weeks
 * before the event decides it, so it is a stored setting rather than something inferred
 * from whether a mat happens to be bound at this instant.
 */
export type EventMode = 'live' | 'entry'
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
  event: { id: number; name: string; date: string; status: EventStatus; mode: EventMode; matCount: number }
  teams: TeamView[]
  rulesets: RulesetView[]
  mats: MatView[]
  matches: MatchView[]
}

// The board's one-mat live composition budgets four queued lines plus the pair on
// deck, and the setup composition shows three per mat. The serializer carries the
// deepest consumer's need, because a shallower cap silently starves a line the
// board has already reserved room for.
export const ON_DECK_DEPTH = 5

// Eight hues at one lightness and one chroma, oklch(0.70 0.14 h), spread 45 degrees
// apart. The previous values were the Tailwind v3 500 ramp, whose lightness spread
// meant a team could be visibly quieter than its opponent on the same wall. Holding
// lightness constant drops the contrast spread from 1.80x to 1.15x.
//
// The KEYS are frozen: they are stored in teams.color and changing one needs a data
// migration. Two of them can no longer match their hue, because eight evenly spread
// hues leave room for only two warm ones. TEAM_COLOR_LABELS is what a person sees,
// so the name always agrees with the swatch.
export const TEAM_COLORS = {
  red: '#e97871',
  blue: '#53a3f2',
  green: '#a1a62b',
  amber: '#54b66e',
  purple: '#ac89e8',
  pink: '#d779ba',
  teal: '#00b5b7',
  orange: '#d78c29',
} as const
export type TeamColor = keyof typeof TEAM_COLORS
export const TEAM_COLOR_KEYS = Object.keys(TEAM_COLORS) as TeamColor[]

export const TEAM_COLOR_LABELS: Record<TeamColor, string> = {
  red: 'Crimson',
  orange: 'Amber',
  green: 'Citron',
  amber: 'Green',
  teal: 'Teal',
  blue: 'Azure',
  purple: 'Violet',
  pink: 'Magenta',
}

// A three letter code cut out of the team fill. Every fill takes --gray-1 text at
// 6.73:1 or better, so the plate is legal at every size for every pair.
export function teamCode(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '')
  if (letters.length >= 3) return letters.slice(0, 3).toUpperCase()
  return (letters + name.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 3).toUpperCase() || 'TBD'
}

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
