CREATE TABLE `deleted_account_sessions` (
	`openIdHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deleted_account_sessions_openIdHash` PRIMARY KEY(`openIdHash`)
);
--> statement-breakpoint
ALTER TABLE `account_deletion_requests` ADD `requestType` enum('account_deletion','replaced_profile_photo') DEFAULT 'account_deletion' NOT NULL;--> statement-breakpoint
CREATE INDEX `deleted_account_sessions_expiry_idx` ON `deleted_account_sessions` (`expiresAt`);