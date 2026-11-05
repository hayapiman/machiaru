import { and, eq, gt, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { deletedAccountSessions, InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { hashDeletedSessionOpenId } from "./_core/account-session";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch {
      console.warn("[Database] Failed to connect");
      _db = null;
    }
  }
  return _db;
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type QueryExecutor = Pick<Database, "select">;

async function hasDeletedAccountSession(db: QueryExecutor, openId: string): Promise<boolean> {
  const now = new Date();
  const openIdHash = hashDeletedSessionOpenId(openId, ENV.cookieSecret);
  const [entry] = await db
    .select({ openIdHash: deletedAccountSessions.openIdHash })
    .from(deletedAccountSessions)
    .where(and(eq(deletedAccountSessions.openIdHash, openIdHash), gt(deletedAccountSessions.expiresAt, now)))
    .limit(1);
  return Boolean(entry);
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    if (await isDeletedAccountSession(user.openId)) {
      throw new Error("Cannot restore an account with a revoked session.");
    }

    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, user.openId))
      .limit(1);

    if (existingUser) {
      // Serialize existing-session upserts with account deletion using the same user-row lock.
      await db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.openId, user.openId))
          .limit(1)
          .for("update");
        if (await hasDeletedAccountSession(tx, user.openId)) {
          throw new Error("Cannot restore an account with a revoked session.");
        }
        await tx.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
      });
    } else {
      if (await isDeletedAccountSession(user.openId)) {
        throw new Error("Cannot restore an account with a revoked session.");
      }
      await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
    }
  } catch (error) {
    console.error("[Database] Failed to upsert user");
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

let lastDeletedSessionPruneAt = 0;

export async function isDeletedAccountSession(openId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable while validating the session.");

  const now = new Date();
  if (Date.now() - lastDeletedSessionPruneAt >= 60 * 60 * 1000) {
    try {
      await db.delete(deletedAccountSessions).where(lte(deletedAccountSessions.expiresAt, now));
      lastDeletedSessionPruneAt = Date.now();
    } catch {
      console.warn("[Database] Could not prune expired session revocation records");
    }
  }

  return hasDeletedAccountSession(db, openId);
}

// TODO: add feature queries here as your schema grows.
