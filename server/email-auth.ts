import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { emailCredentials, users, type User } from "../drizzle/schema";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import type { TrpcContext } from "./_core/context";
import {
  assertEmailAuthAllowed,
  clearEmailAuthFailures,
  hashPassword,
  normalizeEmail,
  recordEmailAuthFailure,
  verifyPassword,
} from "./_core/email-password";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";

type ClientType = "web" | "native";
type EmailAuthInput = { email: string; password: string; clientType: ClientType };
const EMAIL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getInsertId(result: unknown): number {
  const value = result as { insertId?: number; 0?: { insertId?: number } };
  return Number(value?.insertId ?? value?.[0]?.insertId ?? 0);
}

async function requireDatabase() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "アカウントサービスに接続できません。" });
  return db;
}

function duplicateEmailError(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number } | null;
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

function registrationConflict(): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: "このメールアドレスでは登録できません。既存のManusアカウントはプロフィールから連携できます。",
  });
}

function invalidLogin(): TRPCError {
  return new TRPCError({ code: "UNAUTHORIZED", message: "メールアドレスまたはパスワードが正しくありません。" });
}

async function issueSession(ctx: TrpcContext, user: User, clientType: ClientType) {
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name ?? "",
    expiresInMs: EMAIL_SESSION_TTL_MS,
  });

  if (clientType === "web") {
    ctx.res.cookie(getSessionCookieName(ctx.req), sessionToken, {
      ...getSessionCookieOptions(ctx.req),
      maxAge: EMAIL_SESSION_TTL_MS,
    });
  }

  return { user, sessionToken };
}

export async function loginWithEmail(ctx: TrpcContext, input: EmailAuthInput) {
  const email = normalizeEmail(input.email);
  assertEmailAuthAllowed(email);
  const db = await requireDatabase();
  const [credential] = await db
    .select({ userId: emailCredentials.userId, passwordHash: emailCredentials.passwordHash })
    .from(emailCredentials)
    .where(eq(emailCredentials.email, email))
    .limit(1);

  const passwordMatches = await verifyPassword(input.password, credential?.passwordHash);
  if (!credential || !passwordMatches) {
    recordEmailAuthFailure(email);
    throw invalidLogin();
  }

  const [user] = await db.select().from(users).where(eq(users.id, credential.userId)).limit(1);
  if (!user) {
    recordEmailAuthFailure(email);
    throw invalidLogin();
  }

  clearEmailAuthFailures(email);
  const lastSignedIn = new Date();
  await db.update(users).set({ lastSignedIn }).where(eq(users.id, user.id));
  return issueSession(ctx, { ...user, lastSignedIn }, input.clientType);
}

export async function registerEmailAccount(ctx: TrpcContext, input: EmailAuthInput) {
  const email = normalizeEmail(input.email);
  assertEmailAuthAllowed(email);
  const db = await requireDatabase();
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existingUser) {
    recordEmailAuthFailure(email);
    throw registrationConflict();
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const openId = `email_${randomBytes(24).toString("hex")}`;
  const name = email.split("@")[0]?.slice(0, 80) || "まちあるメンバー";

  try {
    const user = await db.transaction(async (tx) => {
      const insertResult = await tx.insert(users).values({
        openId,
        name,
        email,
        loginMethod: "email_password",
        lastSignedIn: now,
      });
      const userId = getInsertId(insertResult);
      if (!userId) throw new Error("Account insert returned no identifier");

      await tx.insert(emailCredentials).values({ userId, email, passwordHash });
      const [createdUser] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!createdUser) throw new Error("Created account could not be loaded");
      return createdUser;
    });

    clearEmailAuthFailures(email);
    return issueSession(ctx, user, input.clientType);
  } catch (error) {
    if (duplicateEmailError(error)) {
      recordEmailAuthFailure(email);
      throw registrationConflict();
    }
    throw error;
  }
}

export async function hasEmailPassword(userId: number): Promise<boolean> {
  const db = await requireDatabase();
  const [credential] = await db
    .select({ userId: emailCredentials.userId })
    .from(emailCredentials)
    .where(eq(emailCredentials.userId, userId))
    .limit(1);
  return Boolean(credential);
}

export async function setEmailPasswordForUser(
  ctx: TrpcContext & { user: User },
  input: { newPassword: string; currentPassword?: string },
) {
  const email = normalizeEmail(ctx.user.email ?? "");
  if (!email) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Manusアカウントにメールアドレスが登録されていないため、メールログインを設定できません。",
    });
  }

  assertEmailAuthAllowed(email);
  const db = await requireDatabase();
  const [existingCredential] = await db
    .select()
    .from(emailCredentials)
    .where(eq(emailCredentials.userId, ctx.user.id))
    .limit(1);

  if (existingCredential) {
    const matches = await verifyPassword(input.currentPassword ?? "", existingCredential.passwordHash);
    if (!matches) {
      recordEmailAuthFailure(email);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "現在のパスワードが正しくありません。" });
    }
  }

  const [emailOwner] = await db
    .select({ userId: emailCredentials.userId })
    .from(emailCredentials)
    .where(eq(emailCredentials.email, email))
    .limit(1);
  if (emailOwner && emailOwner.userId !== ctx.user.id) {
    recordEmailAuthFailure(email);
    throw registrationConflict();
  }

  const passwordHash = await hashPassword(input.newPassword);
  try {
    if (existingCredential) {
      await db
        .update(emailCredentials)
        .set({ email, passwordHash })
        .where(eq(emailCredentials.userId, ctx.user.id));
    } else {
      await db.insert(emailCredentials).values({ userId: ctx.user.id, email, passwordHash });
    }
  } catch (error) {
    if (duplicateEmailError(error)) throw registrationConflict();
    throw error;
  }

  clearEmailAuthFailures(email);
  return { success: true, email, enabled: true } as const;
}
