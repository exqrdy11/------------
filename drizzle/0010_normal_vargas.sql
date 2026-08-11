CREATE TABLE `marketplace_connection_controls` (
	`cabinet_id` text DEFAULT 'metanutrix' NOT NULL,
	`marketplace` text NOT NULL,
	`is_disabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`cabinet_id`, `marketplace`)
);
