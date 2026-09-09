export type WinType = 'submission' | 'points' | 'decision'
export type MatchStatus = 'pending' | 'live' | 'done'
/**
 * 'certified' is the record the organizer signed off on. It reads as done everywhere a
 * status is displayed, and it refuses every write on the event until an admin unlocks it.
 */
export type EventStatus = 'setup' | 'live' | 'done' | 'certified'
/**
 * How the event is run. 'entry' means the desk types every result and no tablet scores a
 * mat; 'live' means the mats drive it and the desk corrects. The walkthrough two weeks
 * before the event decides it, so it is a stored setting rather than something inferred
 * from whether a mat happens to be bound at this instant.
 */
export type EventMode = 'live' | 'entry'
export type MatchEventType = 'score' | 'set_score' | 'clock_start' | 'clock_pause' | 'clock_extend' | 'terminal' | 'end' | 'admin'

export interface RulesetAction { key: string; label: string; points: number }
export interface RulesetTerminal { key: string; label: string; winType: WinType }

export type MatchEventPayload =
  | { kind: 'end'; winnerAthleteId: number; winType: WinType }
  | { kind: 'reopen' }
  | { kind: 'edit_result'; winnerAthleteId: number; winType: WinType; reason?: string }
  | { kind: 'skip' }
  | { kind: 'clock_extend'; addMs: number }

// Why a result was changed after the fact. The desk types it into the Result dialog, and
// it travels with the correction in both the match log and the audit row.
export const CORRECTION_REASON_MAX = 120

/**
 * Who made a write, as it is stored in the audit log. `mat:3` is the tablet scoring mat 3,
 * `desk` is the Entry tab, `admin` is any other console write, and `system` is the server's
 * own sweeps (a clock that ran out, a tablet that stopped answering).
 */
export type AuditActor = 'admin' | 'desk' | 'system' | 'mat' | `mat:${number}`

export type AuditAction =
  | 'score' | 'terminal' | 'clock_start' | 'clock_pause' | 'clock_extend'
  | 'end' | 'undo' | 'skip' | 'reopen' | 'entry' | 'correction'
  | 'bind' | 'takeover' | 'unbind' | 'advance'
  | 'create' | 'event_edit' | 'mode' | 'contact' | 'mat_count' | 'far' | 'start' | 'finish' | 'delete'
  | 'certify' | 'uncertify'
  | 'team_edit'
  | 'roster_add' | 'roster_edit' | 'roster_assign' | 'roster_remove' | 'roster_sync' | 'roster_link'
  | 'match_create' | 'match_edit' | 'match_delete' | 'generate' | 'reorder'
  | 'ruleset_create' | 'ruleset_edit' | 'ruleset_delete'
  // Backfilled rows carry the match event's own type, and two of those are not verbs any
  // live write records: a desk entry's absolute score, and the pre-0007 admin event kind.
  | 'set_score' | 'admin'

export type AuditDetail = Record<string, unknown>

export interface AuditEntry {
  id: number
  at: string
  actor: AuditActor
  action: AuditAction
  detail: AuditDetail
}

// What one sync moved on one athlete, field by field, as the profile sheet prints it.
// An empty object is a row the sync read and found already right.
export interface ProfileChange { from: unknown; to: unknown }
export type SyncChanges = Record<string, ProfileChange>

// One run of the WellnessLiving matcher, whether from an import or the Roster tab's own
// button. Names are "First Last", so the web prints them without a lookup.
export interface MatchReport {
  matched: string[]
  refreshed: number
  unmatched: string[]
  ambiguous: string[]
  duplicates: string[]
}

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

// Null unless both halves are filled: a name with no number, or a number with no name,
// gives a volunteer nothing to act on, so the line is not printed at all.
export interface EventContact { name: string; phone: string }

export interface Snapshot {
  version: number
  now: string
  event: { id: number; name: string; date: string; status: EventStatus; mode: EventMode; matCount: number; contact: EventContact | null; certifiedAt: string | null; far: number | null }
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

// A referee adds time to finish a match that ran out, not to invent a new one, so the
// control offers half a minute at the low end and five minutes at the high end.
export const EXTEND_MIN_MS = 30_000
export const EXTEND_MAX_MS = 300_000

// The board's far correction on a win probability read, source 9.1. 1.0 is neutral; the
// range is bounded so a mistyped value cannot invert or flatten the read.
export const FAR_MIN = 0.85
export const FAR_MAX = 1.2
