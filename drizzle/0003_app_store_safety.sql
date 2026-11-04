CREATE TABLE `account_deletion_requests` (
	`requestCode` varchar(36) NOT NULL,
	`storageKeys` json NOT NULL,
	`status` enum('pending_storage_purge','completed') NOT NULL DEFAULT 'pending_storage_purge',
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `account_deletion_requests_requestCode` PRIMARY KEY(`requestCode`)
);
--> statement-breakpoint
CREATE TABLE `moderation_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`reporterUserId` int,
	`targetUserId` int,
	`targetType` enum('walk','spot','user') NOT NULL,
	`targetId` int NOT NULL,
	`reason` enum('inappropriate','harassment','privacy','spam','other') NOT NULL,
	`details` text,
	`status` enum('open','resolved','dismissed') NOT NULL DEFAULT 'open',
	`resolution` enum('dismiss','remove','block'),
	`moderatorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `moderation_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`blockerUserId` int NOT NULL,
	`blockedUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_blocks_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_blocks_pair_unique_idx` UNIQUE(`blockerUserId`,`blockedUserId`)
);
--> statement-breakpoint
ALTER TABLE `visited_spots` ADD `moderationStatus` enum('pending','approved','rejected') DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `walk_sessions` ADD `moderationStatus` enum('pending','approved','rejected') DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `moderation_reports` ADD CONSTRAINT `moderation_reports_groupId_walk_groups_id_fk` FOREIGN KEY (`groupId`) REFERENCES `walk_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderation_reports` ADD CONSTRAINT `moderation_reports_reporterUserId_users_id_fk` FOREIGN KEY (`reporterUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderation_reports` ADD CONSTRAINT `moderation_reports_targetUserId_users_id_fk` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderation_reports` ADD CONSTRAINT `moderation_reports_moderatorUserId_users_id_fk` FOREIGN KEY (`moderatorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockerUserId_users_id_fk` FOREIGN KEY (`blockerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_blocks` ADD CONSTRAINT `user_blocks_blockedUserId_users_id_fk` FOREIGN KEY (`blockedUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_deletion_requests_status_idx` ON `account_deletion_requests` (`status`,`requestedAt`);--> statement-breakpoint
CREATE INDEX `moderation_reports_group_status_idx` ON `moderation_reports` (`groupId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `moderation_reports_target_idx` ON `moderation_reports` (`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `user_blocks_blocked_idx` ON `user_blocks` (`blockedUserId`);