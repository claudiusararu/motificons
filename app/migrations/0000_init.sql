CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text,
	`workspaceId` text,
	`name` text NOT NULL,
	`styleSettings` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_workspaceId_idx` ON `collection` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `collectionItem` (
	`id` text PRIMARY KEY NOT NULL,
	`collectionId` text NOT NULL,
	`iconId` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collectionItem_collectionId_idx` ON `collectionItem` (`collectionId`);--> statement-breakpoint
CREATE INDEX `collectionItem_collection_icon_idx` ON `collectionItem` (`collectionId`,`iconId`);--> statement-breakpoint
CREATE INDEX `collectionItem_iconId_idx` ON `collectionItem` (`iconId`);--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invitedByUserId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitedByUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_unique` ON `invite` (`token`);--> statement-breakpoint
CREATE TABLE `mcpKey` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`workspaceId` text NOT NULL,
	`keyPrefix` text NOT NULL,
	`keyHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	`revokedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcpKey_keyHash_unique` ON `mcpKey` (`keyHash`);--> statement-breakpoint
CREATE TABLE `membership` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`workspaceId` text NOT NULL,
	`role` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT 'web' NOT NULL,
	`defaultExportFormat` text DEFAULT 'svg' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `styleProfile` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`referenceIcons` text NOT NULL,
	`computedTargets` text,
	`manualOverrides` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `styleProfile_projectId_unique` ON `styleProfile` (`projectId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`personal` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL
);
