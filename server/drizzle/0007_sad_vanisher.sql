CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`match_id` integer,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_event_idx` ON `audit_log` (`event_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_match_idx` ON `audit_log` (`match_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `certified_at` text;--> statement-breakpoint
INSERT INTO `audit_log` (`event_id`, `match_id`, `actor`, `action`, `detail`, `at`)
SELECT
	m.event_id,
	me.match_id,
	CASE
		WHEN me.id LIKE 'entry:%' THEN 'desk'
		WHEN me.id LIKE 'admin:%' THEN 'admin'
		WHEN me.id LIKE 'expiry:%' THEN 'system'
		WHEN mt.number IS NOT NULL THEN 'mat:' || mt.number
		ELSE 'system'
	END,
	me.type,
	json_object('seq', me.seq, 'backfilled', json('true')),
	me.at
FROM `match_events` me
JOIN `matches` m ON m.id = me.match_id
LEFT JOIN `mats` mt ON mt.id = m.mat_id
ORDER BY me.at, me.match_id, me.seq;
