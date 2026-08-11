CREATE TABLE IF NOT EXISTS `inventory_snapshots` (
  `cabinet_id` text PRIMARY KEY NOT NULL,
  `payload_json` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
