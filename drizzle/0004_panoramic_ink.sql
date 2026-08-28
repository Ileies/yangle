ALTER TABLE `albums` ADD `invite_token` text;--> statement-breakpoint
ALTER TABLE `albums` ADD `invite_role` text;--> statement-breakpoint
CREATE UNIQUE INDEX `albums_invite_token_unique` ON `albums` (`invite_token`);--> statement-breakpoint
ALTER TABLE `magic_links` ADD `redirect_to` text;