CREATE TABLE `email_credentials` (
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_credentials_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `email_credentials_email_unique_idx` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `email_credentials` ADD CONSTRAINT `email_credentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;