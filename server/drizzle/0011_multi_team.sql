CREATE TABLE `proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`athlete_a_id` integer NOT NULL,
	`athlete_b_id` integer NOT NULL,
	`cost` real NOT NULL,
	`why` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_a_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_b_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposals_event_idx` ON `proposals` (`event_id`);--> statement-breakpoint
ALTER TABLE `matches` ADD `source` text DEFAULT 'designed' NOT NULL;