ALTER TABLE `athletes` ADD `promoted_at` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `synced_at` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `sync_changes` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `suggested_wl_uid` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `suggested_score` real;--> statement-breakpoint
ALTER TABLE `athletes` ADD `dismissed_wl_uids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `wl_locations` text;--> statement-breakpoint
ALTER TABLE `roster_candidates` ADD `promoted_at` text;