CREATE TABLE `fbs_order_handover_metrics` (
	`cabinet_id` text NOT NULL,
	`order_id` integer NOT NULL,
	`warehouse_id` text DEFAULT 'unknown' NOT NULL,
	`created_at` text NOT NULL,
	`first_state` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`handed_over_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`cabinet_id`, `order_id`)
);
