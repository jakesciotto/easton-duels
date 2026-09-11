import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'
import type { RulesetAction, RulesetTerminal, MatchEventPayload, AuditAction, AuditActor, AuditDetail, MatchSource, SyncChanges } from '../shared/types.js'

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  date: text('date').notNull(),
  matCount: integer('mat_count').notNull(),
  matCode: text('mat_code').notNull(),
  status: text('status', { enum: ['setup', 'live', 'done', 'certified'] }).notNull().default('setup'),
  // How the event is run, decided at the walkthrough two weeks out. 'entry' means the
  // desk types every result and no tablet scores a mat. 'live' means the mats drive it.
  // Existing events default to 'live', which is the behaviour they were created under.
  mode: text('mode', { enum: ['live', 'entry'] }).notNull().default('live'),
  sameGender: integer('same_gender', { mode: 'boolean' }).notNull().default(false),
  // Who a volunteer calls when something goes wrong. Every surface prints the pair, so a
  // half-filled contact is worse than none and reads as absent.
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  // Set when an admin certifies the event and cleared when one unlocks it, so the board
  // and the console can print the time the record was signed off rather than only a status.
  certifiedAt: text('certified_at'),
  // Referee bias correction, 0.85 to 1.2, applied to the board's win probability read.
  // Null until an admin sets it, and the board falls back to 1.0. Written into the event
  // so a second browser or a cleared cache sees the same number rather than reverting.
  far: real('far'),
  // The WellnessLiving locations this event syncs, as kBusiness ids. Null until the first
  // sync stores the pick, so every later sync runs on one press.
  wlLocations: text('wl_locations', { mode: 'json' }).$type<string[]>(),
  createdAt: text('created_at').notNull(),
  version: integer('version').notNull().default(0),
})

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  position: integer('position').notNull(),
}, t => [index('teams_event_idx').on(t.eventId)])

export const athletes = sqliteTable('athletes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  age: integer('age'),
  ageSource: text('age_source', { enum: ['manual', 'leaderboard', 'wl'] }),
  weightLbs: integer('weight_lbs'),
  weightSource: text('weight_source', { enum: ['manual', 'leaderboard'] }),
  belt: text('belt'),
  gender: text('gender'),
  source: text('source', { enum: ['wl', 'manual'] }).notNull(),
  wlUid: text('wl_uid'),
  wlLocation: text('wl_location'),
  leaderboardId: text('leaderboard_id'),
  erp: real('erp'),
  // The profile the last sync left. promotedAt dates the belt above; syncedAt is when a
  // sync last wrote this row; syncChanges is what that sync moved, {} when nothing did.
  promotedAt: text('promoted_at'),
  syncedAt: text('synced_at'),
  syncChanges: text('sync_changes', { mode: 'json' }).$type<SyncChanges>(),
  // A near match never links itself. One candidate waits here for a person to confirm it,
  // and every candidate a person has refused stays refused across later syncs.
  suggestedWlUid: text('suggested_wl_uid'),
  suggestedScore: real('suggested_score'),
  dismissedWlUids: text('dismissed_wl_uids', { mode: 'json' }).$type<string[]>().notNull().default([]),
}, t => [
  index('athletes_event_idx').on(t.eventId),
  uniqueIndex('athletes_event_wl_uid_idx').on(t.eventId, t.wlUid),
])

export const rosterCandidates = sqliteTable('roster_candidates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  wlUid: text('wl_uid').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  belt: text('belt'),
  wlLocation: text('wl_location'),
  leaderboardId: text('leaderboard_id'),
  erp: real('erp'),
  age: integer('age'),
  weightLbs: integer('weight_lbs'),
  gender: text('gender'),
  promotedAt: text('promoted_at'),
}, t => [
  index('roster_candidates_event_idx').on(t.eventId),
  uniqueIndex('roster_candidates_event_wl_uid_idx').on(t.eventId, t.wlUid),
])

export const rulesets = sqliteTable('rulesets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  defaultLengthSec: integer('default_length_sec').notNull(),
  actions: text('actions', { mode: 'json' }).$type<RulesetAction[]>().notNull(),
  terminals: text('terminals', { mode: 'json' }).$type<RulesetTerminal[]>().notNull(),
})

export const mats = sqliteTable('mats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  currentMatchId: integer('current_match_id'),
  lastHeartbeatAt: text('last_heartbeat_at'),
  bound: integer('bound', { mode: 'boolean' }).notNull().default(false),
  // Bumped every time a tablet binds this mat, so the token an earlier tablet still holds
  // stops being accepted the moment a second one takes the mat over.
  bindEpoch: integer('bind_epoch').notNull().default(0),
}, t => [uniqueIndex('mats_event_number_idx').on(t.eventId, t.number)])

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  matId: integer('mat_id').references(() => mats.id, { onDelete: 'set null' }),
  orderIndex: integer('order_index').notNull(),
  rulesetId: integer('ruleset_id').notNull().references(() => rulesets.id),
  lengthSec: integer('length_sec').notNull(),
  // The sum of the clock_extend events, kept as a cache because the clock's real length is
  // read on every poll and by the expiry sweep, which never load the event log. lengthSec
  // stays the designed length so a recompute can rebuild this from the log alone.
  extensionMs: integer('extension_ms').notNull().default(0),
  athleteAId: integer('athlete_a_id').notNull().references(() => athletes.id),
  athleteBId: integer('athlete_b_id').notNull().references(() => athletes.id),
  status: text('status', { enum: ['pending', 'live', 'done'] }).notNull().default('pending'),
  winnerAthleteId: integer('winner_athlete_id'),
  winType: text('win_type', { enum: ['submission', 'points', 'decision'] }),
  pointsA: integer('points_a').notNull().default(0),
  pointsB: integer('points_b').notNull().default(0),
  clockElapsedMs: integer('clock_elapsed_ms').notNull().default(0),
  clockStartedAt: text('clock_started_at'),
  pendingTerminalAthleteId: integer('pending_terminal_athlete_id'),
  pendingTerminalKey: text('pending_terminal_key'),
  lastSeq: integer('last_seq').notNull().default(0),
  why: text('why'),
  // Where the pairing came from: the proposer, or a person in the Add match dialog.
  // Rows written before 0011 were all designed by hand or by the retired generator.
  source: text('source', { enum: ['designed', 'proposed'] }).$type<MatchSource>().notNull().default('designed'),
}, t => [
  index('matches_event_order_idx').on(t.eventId, t.orderIndex),
  index('matches_mat_idx').on(t.matId),
])

// A draft pairing the organizer has not confirmed. Nothing here reaches the board: a
// proposal becomes a match only through the confirm route, which deletes it in the same
// transaction. Proposing again replaces the whole set for the event.
export const proposals = sqliteTable('proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  athleteAId: integer('athlete_a_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  athleteBId: integer('athlete_b_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  cost: real('cost').notNull(),
  why: text('why').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('proposals_event_idx').on(t.eventId)])

export const rateLimits = sqliteTable('rate_limits', {
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  windowStart: text('window_start').notNull(),
  count: integer('count').notNull(),
}, t => [primaryKey({ columns: [t.scope, t.key] })])

export const matchEvents = sqliteTable('match_events', {
  id: text('id').primaryKey(),
  matchId: integer('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  type: text('type', { enum: ['score', 'set_score', 'clock_start', 'clock_pause', 'clock_extend', 'terminal', 'end', 'admin'] }).notNull(),
  athleteId: integer('athlete_id'),
  actionKey: text('action_key'),
  points: integer('points'),
  payload: text('payload', { mode: 'json' }).$type<MatchEventPayload>(),
  at: text('at').notNull(),
}, t => [uniqueIndex('match_events_match_seq_idx').on(t.matchId, t.seq)])

// Append only, and deliberately free of foreign keys: the trail of what was done to an
// event has to outlive the rows it describes, including the event itself.
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull(),
  matchId: integer('match_id'),
  actor: text('actor').$type<AuditActor>().notNull(),
  action: text('action').$type<AuditAction>().notNull(),
  detail: text('detail', { mode: 'json' }).$type<AuditDetail>().notNull().default({}),
  at: text('at').notNull(),
}, t => [
  index('audit_log_event_idx').on(t.eventId, t.id),
  index('audit_log_match_idx').on(t.matchId),
])

export type EventRow = typeof events.$inferSelect
export type TeamRow = typeof teams.$inferSelect
export type AthleteRow = typeof athletes.$inferSelect
export type RosterCandidateRow = typeof rosterCandidates.$inferSelect
export type RulesetRow = typeof rulesets.$inferSelect
export type MatRow = typeof mats.$inferSelect
export type MatchRow = typeof matches.$inferSelect
export type ProposalRow = typeof proposals.$inferSelect
export type MatchEventRow = typeof matchEvents.$inferSelect
export type RateLimitRow = typeof rateLimits.$inferSelect
