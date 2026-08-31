CREATE TABLE `rate_limits` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
