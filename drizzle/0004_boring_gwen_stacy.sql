CREATE TABLE `ff_stock_batches` (
	`cabinet_id` text DEFAULT 'metanutrix' NOT NULL,
	`product_key` text NOT NULL,
	`nm_id` integer,
	`sku` text DEFAULT '' NOT NULL,
	`location` text NOT NULL,
	`batch_code` text DEFAULT '' NOT NULL,
	`expires_at` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`cabinet_id`, `product_key`, `location`, `batch_code`, `expires_at`)
);
--> statement-breakpoint
INSERT INTO `ff_stock_batches` (`cabinet_id`, `product_key`, `nm_id`, `sku`, `location`, `batch_code`, `expires_at`, `quantity`, `updated_at`)
SELECT `cabinet_id`, `product_key`, `nm_id`, `sku`, `location`, '', COALESCE(`expires_at`, ''), `quantity`, `updated_at`
FROM `ff_stocks`;
