PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ff_stocks` (
	`cabinet_id` text DEFAULT 'metanutrix' NOT NULL,
	`product_key` text NOT NULL,
	`nm_id` integer,
	`sku` text DEFAULT '' NOT NULL,
	`location` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`cabinet_id`, `product_key`, `location`)
);
--> statement-breakpoint
INSERT INTO `__new_ff_stocks`("cabinet_id", "product_key", "nm_id", "sku", "location", "quantity", "expires_at", "updated_at") SELECT "cabinet_id", "product_key", "nm_id", "sku", "location", "quantity", "expires_at", "updated_at" FROM `ff_stocks`;--> statement-breakpoint
DROP TABLE `ff_stocks`;--> statement-breakpoint
ALTER TABLE `__new_ff_stocks` RENAME TO `ff_stocks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_ff_warehouses` (
	`cabinet_id` text DEFAULT 'metanutrix' NOT NULL,
	`id` text NOT NULL,
	`city` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`cabinet_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_ff_warehouses`("cabinet_id", "id", "city", "name", "position", "created_at") SELECT "cabinet_id", "id", "city", "name", "position", "created_at" FROM `ff_warehouses`;--> statement-breakpoint
DROP TABLE `ff_warehouses`;--> statement-breakpoint
ALTER TABLE `__new_ff_warehouses` RENAME TO `ff_warehouses`;