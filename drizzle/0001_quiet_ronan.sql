CREATE TABLE `group_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','member') NOT NULL DEFAULT 'member',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `group_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_members_unique_idx` UNIQUE(`groupId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `spot_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`spotId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`assetUrl` varchar(1024) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spot_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`userId` int NOT NULL,
	`displayName` varchar(80),
	`avatarUrl` varchar(1024),
	`avatarStorageKey` varchar(512),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `visited_spots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`groupId` int,
	`sessionId` int,
	`title` varchar(120) NOT NULL,
	`description` text,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`visitedAt` timestamp NOT NULL,
	`visibility` enum('private','group') NOT NULL DEFAULT 'private',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visited_spots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `walk_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`inviteCode` varchar(12) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `walk_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `walk_groups_inviteCode_unique` UNIQUE(`inviteCode`)
);
--> statement-breakpoint
CREATE TABLE `walk_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`groupId` int,
	`title` varchar(120),
	`startedAt` timestamp NOT NULL,
	`endedAt` timestamp NOT NULL,
	`durationSeconds` int NOT NULL,
	`distanceMeters` double NOT NULL DEFAULT 0,
	`averageSpeedMps` double NOT NULL DEFAULT 0,
	`stepCount` int NOT NULL DEFAULT 0,
	`visibility` enum('private','group') NOT NULL DEFAULT 'private',
	`routeData` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `walk_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_groupId_walk_groups_id_fk` FOREIGN KEY (`groupId`) REFERENCES `walk_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `spot_photos` ADD CONSTRAINT `spot_photos_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `spot_photos` ADD CONSTRAINT `spot_photos_spotId_visited_spots_id_fk` FOREIGN KEY (`spotId`) REFERENCES `visited_spots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visited_spots` ADD CONSTRAINT `visited_spots_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visited_spots` ADD CONSTRAINT `visited_spots_groupId_walk_groups_id_fk` FOREIGN KEY (`groupId`) REFERENCES `walk_groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visited_spots` ADD CONSTRAINT `visited_spots_sessionId_walk_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `walk_sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `walk_groups` ADD CONSTRAINT `walk_groups_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `walk_sessions` ADD CONSTRAINT `walk_sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `walk_sessions` ADD CONSTRAINT `walk_sessions_groupId_walk_groups_id_fk` FOREIGN KEY (`groupId`) REFERENCES `walk_groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`userId`);--> statement-breakpoint
CREATE INDEX `spot_photos_spot_idx` ON `spot_photos` (`spotId`);--> statement-breakpoint
CREATE INDEX `visited_spots_user_date_idx` ON `visited_spots` (`userId`,`visitedAt`);--> statement-breakpoint
CREATE INDEX `visited_spots_group_date_idx` ON `visited_spots` (`groupId`,`visitedAt`);--> statement-breakpoint
CREATE INDEX `walk_groups_owner_idx` ON `walk_groups` (`ownerUserId`);--> statement-breakpoint
CREATE INDEX `walk_sessions_user_date_idx` ON `walk_sessions` (`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `walk_sessions_group_date_idx` ON `walk_sessions` (`groupId`,`startedAt`);