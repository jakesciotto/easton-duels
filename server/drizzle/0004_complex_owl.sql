CREATE TABLE `roster_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`wl_uid` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`belt` text,
	`wl_location` text,
	`leaderboard_id` text,
	`erp` real,
	`age` integer,
	`weight_lbs` integer,
	`gender` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roster_candidates_event_idx` ON `roster_candidates` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `roster_candidates_event_wl_uid_idx` ON `roster_candidates` (`event_id`,`wl_uid`);