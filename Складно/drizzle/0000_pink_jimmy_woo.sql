CREATE TABLE `ff_stocks` (
	`product_key` text NOT NULL,
	`nm_id` integer,
	`sku` text DEFAULT '' NOT NULL,
	`location` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`product_key`, `location`)
);
