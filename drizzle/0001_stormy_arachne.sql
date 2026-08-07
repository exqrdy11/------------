CREATE TABLE `ff_warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
