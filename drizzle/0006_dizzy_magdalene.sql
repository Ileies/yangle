ALTER TABLE `magic_links` ADD `code` text;--> statement-breakpoint
ALTER TABLE `magic_links` ADD `code_attempts` integer DEFAULT 0 NOT NULL;