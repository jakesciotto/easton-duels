ALTER TABLE `mats` ADD `last_heartbeat_at` text;--> statement-breakpoint
ALTER TABLE `mats` ADD `bound` integer DEFAULT false NOT NULL;