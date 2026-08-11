CREATE TABLE IF NOT EXISTS `target_price_products` (
  `cabinet_id` text NOT NULL,
  `product_key` text NOT NULL,
  `sku` text NOT NULL,
  `nm_id` integer,
  `orders` integer DEFAULT 0 NOT NULL,
  `price_before_spp` real,
  `spp_percent` real,
  `current_price` real,
  `updated_at` text,
  `search_query` text,
  `competitors_json` text DEFAULT '[]' NOT NULL,
  `candidate_nm_id` integer,
  `score` real,
  `reason` text,
  `source_status` text,
  `refreshed_at` text,
  `refresh_error` text,
  PRIMARY KEY(`cabinet_id`, `product_key`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `target_price_products_cabinet_orders` ON `target_price_products` (`cabinet_id`, `orders` DESC);
