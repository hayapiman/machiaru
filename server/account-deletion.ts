import { randomUUID } from "node:crypto";
import { ONE_YEAR_MS } from "../shared/const.js";
import { and, asc, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  accountDeletionRequests,
  deletedAccountSessions,
  groupMembers,
  moderationReports,
  spotPhotos,
  userProfiles,
  users,
  visitedSpots,
  walkGroups,
  walkSessions,
} from "../drizzle/schema";
import { hashDeletedSessionOpenId } from "./_core/account-session";
import { ENV } from "./_core/env";
import { getDb } from "./db";

export async function deleteAccount(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is unavailable." });

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, openId: users.openId }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "アカウントが見つかりません。" });

    const [profile] = await tx
      .select({ avatarStorageKey: userProfiles.avatarStorageKey })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    const photoRows = await tx
      .select({ storageKey: spotPhotos.storageKey })
      .from(spotPhotos)
      .where(eq(spotPhotos.userId, userId));
    const storageKeys = [...new Set([
      ...(profile?.avatarStorageKey ? [profile.avatarStorageKey] : []),
      ...photoRows.map((photo) => photo.storageKey),
    ])];

    const ownedGroups = await tx
      .select({ id: walkGroups.id })
      .from(walkGroups)
      .where(eq(walkGroups.ownerUserId, userId));

    for (const group of ownedGroups) {
      const [successor] = await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), ne(groupMembers.userId, userId)))
        .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.userId))
        .limit(1);

      if (successor) {
        await tx.update(walkGroups).set({ ownerUserId: successor.userId }).where(eq(walkGroups.id, group.id));
        await tx
          .update(groupMembers)
          .set({ role: "owner" })
          .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, successor.userId)));
      } else {
        await tx
          .update(walkSessions)
          .set({ groupId: null, visibility: "private" })
          .where(eq(walkSessions.groupId, group.id));
        await tx
          .update(visitedSpots)
          .set({ groupId: null, visibility: "private" })
          .where(eq(visitedSpots.groupId, group.id));
        await tx.delete(walkGroups).where(eq(walkGroups.id, group.id));
      }
    }

    const requestCode = randomUUID();
    const completedWithoutFiles = storageKeys.length === 0;
    const expiresAt = new Date(Date.now() + ONE_YEAR_MS);
    await tx.insert(deletedAccountSessions).values({
      openIdHash: hashDeletedSessionOpenId(user.openId, ENV.cookieSecret),
      expiresAt,
    }).onDuplicateKeyUpdate({ set: { expiresAt } });
    await tx.insert(accountDeletionRequests).values({
      requestCode,
      storageKeys,
      requestType: "account_deletion",
      status: completedWithoutFiles ? "completed" : "pending_storage_purge",
      completedAt: completedWithoutFiles ? new Date() : null,
    });
    await tx
      .update(moderationReports)
      .set({ details: null })
      .where(eq(moderationReports.reporterUserId, userId));
    await tx.delete(users).where(eq(users.id, userId));

    return {
      requestCode,
      status: completedWithoutFiles ? "completed" as const : "pending_storage_purge" as const,
      photoObjectsPending: storageKeys.length,
    };
  });
}
