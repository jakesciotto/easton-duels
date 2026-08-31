import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { RulesetAction, RulesetTerminal, MatchEventPayload } from '../shared/types.js'

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
  status: text('status', { enum: ['setup', 'live', 'done'] }).notNull().default('setup'),
  maxAgeGap: integer('max_age_gap').notNull().default(1),
  maxWeightGap: integer('max_weight_gap').notNull().default(10),
  sameGender: integer('same_gender', { mode: 'boolean' }).notNull().default(false),
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
}, t => [
  index('athletes_event_idx').on(t.eventId),
  uniqueIndex('athletes_event_wl_uid_idx').on(t.eventId, t.wlUid),
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
}, t => [uniqueIndex('mats_event_number_idx').on(t.eventId, t.number)])

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  matId: integer('mat_id').references(() => mats.id, { onDelete: 'set null' }),
  orderIndex: integer('order_index').notNull(),
  rulesetId: integer('ruleset_id').notNull().references(() => rulesets.id),
  lengthSec: integer('length_sec').notNull(),
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
}, t => [
  index('matches_event_order_idx').on(t.eventId, t.orderIndex),
  index('matches_mat_idx').on(t.matId),
])

export const matchEvents = sqliteTable('match_events', {
  id: text('id').primaryKey(),
  matchId: integer('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  type: text('type', { enum: ['score', 'set_score', 'clock_start', 'clock_pause', 'terminal', 'end', 'admin'] }).notNull(),
  athleteId: integer('athlete_id'),
  actionKey: text('action_key'),
  points: integer('points'),
  payload: text('payload', { mode: 'json' }).$type<MatchEventPayload>(),
  at: text('at').notNull(),
}, t => [uniqueIndex('match_events_match_seq_idx').on(t.matchId, t.seq)])

export type EventRow = typeof events.$inferSelect
export type TeamRow = typeof teams.$inferSelect
export type AthleteRow = typeof athletes.$inferSelect
export type RulesetRow = typeof rulesets.$inferSelect
export type MatRow = typeof mats.$inferSelect
export type MatchRow = typeof matches.$inferSelect
export type MatchEventRow = typeof matchEvents.$inferSelect
