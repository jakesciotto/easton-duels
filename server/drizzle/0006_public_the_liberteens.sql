ALTER TABLE `events` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `events` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `extension_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mats` ADD `bind_epoch` integer DEFAULT 0 NOT NULL;