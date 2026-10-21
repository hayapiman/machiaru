import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { double, index, json, uniqueIndex } from "drizzle-orm/mysql-core";
/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const emailCredentials = mysqlTable(
  "email_credentials",
  {
    userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [uniqueIndex("email_credentials_email_unique_idx").on(table.email)],
);

// TODO: Add your tables here

export type RoutePoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  speedMps?: number | null;
  breakBefore?: boolean;
};

export const userProfiles = mysqlTable("user_profiles", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 80 }),
  avatarUrl: varchar("avatarUrl", { length: 1024 }),
  avatarStorageKey: varchar("avatarStorageKey", { length: 512 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const walkGroups = mysqlTable(
  "walk_groups",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    inviteCode: varchar("inviteCode", { length: 12 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("walk_groups_owner_idx").on(table.ownerUserId)],
);

export const groupMembers = mysqlTable(
  "group_members",
  {
    id: int("id").autoincrement().primaryKey(),
    groupId: int("groupId").notNull().references(() => walkGroups.id, { onDelete: "cascade" }),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["owner", "member"]).default("member").notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("group_members_unique_idx").on(table.groupId, table.userId),
    index("group_members_user_idx").on(table.userId),
  ],
);

export const walkSessions = mysqlTable(
  "walk_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    groupId: int("groupId").references(() => walkGroups.id, { onDelete: "set null" }),
    title: varchar("title", { length: 120 }),
    startedAt: timestamp("startedAt").notNull(),
    endedAt: timestamp("endedAt").notNull(),
    durationSeconds: int("durationSeconds").notNull(),
    distanceMeters: double("distanceMeters").notNull().default(0),
    averageSpeedMps: double("averageSpeedMps").notNull().default(0),
    stepCount: int("stepCount").notNull().default(0),
    visibility: mysqlEnum("visibility", ["private", "group"]).default("private").notNull(),
    routeData: json("routeData").$type<RoutePoint[]>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("walk_sessions_user_date_idx").on(table.userId, table.startedAt),
    index("walk_sessions_group_date_idx").on(table.groupId, table.startedAt),
  ],
);

export const visitedSpots = mysqlTable(
  "visited_spots",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    groupId: int("groupId").references(() => walkGroups.id, { onDelete: "set null" }),
    sessionId: int("sessionId").references(() => walkSessions.id, { onDelete: "set null" }),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description"),
    latitude: double("latitude").notNull(),
    longitude: double("longitude").notNull(),
    visitedAt: timestamp("visitedAt").notNull(),
    visibility: mysqlEnum("visibility", ["private", "group"]).default("private").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("visited_spots_user_date_idx").on(table.userId, table.visitedAt),
    index("visited_spots_group_date_idx").on(table.groupId, table.visitedAt),
  ],
);

export const spotPhotos = mysqlTable(
  "spot_photos",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    spotId: int("spotId").notNull().references(() => visitedSpots.id, { onDelete: "cascade" }),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    assetUrl: varchar("assetUrl", { length: 1024 }).notNull(),
    mimeType: varchar("mimeType", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("spot_photos_spot_idx").on(table.spotId)],
);
