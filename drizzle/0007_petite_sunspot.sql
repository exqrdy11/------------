CREATE TABLE `marketplace_credentials` (
	`cabinet_id` text DEFAULT 'metanutrix' NOT NULL,
	`marketplace` text NOT NULL,
	`client_id` text,
	`api_key_ciphertext` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`cabinet_id`, `marketplace`)
);
