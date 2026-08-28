CREATE TABLE `athletes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`team_id` integer,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`age` integer,
	`age_source` text,
	`weight_lbs` integer,
	`weight_source` text,
	`belt` text,
	`gender` text,
	`source` text NOT NULL,
	`wl_uid` text,
	`wl_location` text,
	`leaderboard_id` text,
	`erp` real,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `athletes_event_idx` ON `athletes` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `athletes_event_wl_uid_idx` ON `athletes` (`event_id`,`wl_uid`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`mat_count` integer NOT NULL,
	`mat_code` text NOT NULL,
	`status` text DEFAULT 'setup' NOT NULL,
	`max_age_gap` integer DEFAULT 1 NOT NULL,
	`max_weight_gap` integer DEFAULT 10 NOT NULL,
	`same_gender` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`athlete_id` integer,
	`action_key` text,
	`points` integer,
	`payload` text,
	`at` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_events_match_seq_idx` ON `match_events` (`match_id`,`seq`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`mat_id` integer,
	`order_index` integer NOT NULL,
	`ruleset_id` integer NOT NULL,
	`length_sec` integer NOT NULL,
	`athlete_a_id` integer NOT NULL,
	`athlete_b_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`winner_athlete_id` integer,
	`win_type` text,
	`points_a` integer DEFAULT 0 NOT NULL,
	`points_b` integer DEFAULT 0 NOT NULL,
	`clock_elapsed_ms` integer DEFAULT 0 NOT NULL,
	`clock_started_at` text,
	`pending_terminal_athlete_id` integer,
	`pending_terminal_key` text,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`why` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mat_id`) REFERENCES `mats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`athlete_a_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`athlete_b_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_event_order_idx` ON `matches` (`event_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `matches_mat_idx` ON `matches` (`mat_id`);--> statement-breakpoint
CREATE TABLE `mats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`number` integer NOT NULL,
	`current_match_id` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mats_event_number_idx` ON `mats` (`event_id`,`number`);--> statement-breakpoint
CREATE TABLE `rulesets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`default_length_sec` integer NOT NULL,
	`actions` text NOT NULL,
	`terminals` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `teams_event_idx` ON `teams` (`event_id`);