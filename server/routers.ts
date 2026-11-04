import { and, asc, desc, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  groupMembers,
  accountDeletionRequests,
  moderationReports,
  spotPhotos,
  userBlocks,
  userProfiles,
  users,
  visitedSpots,
  walkGroups,
  walkSessions,
  type RoutePoint,
} from "../drizzle/schema";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { deleteAccount as deleteAccountData } from "./account-deletion";
import { hasEmailPassword, loginWithEmail, registerEmailAccount, setEmailPasswordForUser } from "./email-auth";
import { fetchStaticMap } from "./map-service";
import { getBlockedUserIds, requireUsersNotBlocked } from "./moderation";
import { storagePut } from "./storage";
import { storageGetSignedUrl } from "./storage";

const emailInput = z.string().trim().email().max(320);
const passwordInput = z
  .string()
  .min(12, "パスワードは12文字以上で入力してください。")
  .max(128, "パスワードは128文字以内で入力してください。")
  .refine((password) => password.trim().length > 0, "空白だけのパスワードは使えません。");
const emailAuthInput = z.object({
  email: emailInput,
  password: passwordInput,
  clientType: z.enum(["web", "native"]),
});

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is unavailable." });
  return db;
}

async function requireGroupMember(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  groupId: number,
  userId: number,
) {
  const [membership] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "このグループの共有記録にアクセスできません。" });
  }
}

async function requireGroupOwner(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  groupId: number,
  userId: number,
) {
  const [group] = await db.select({ ownerUserId: walkGroups.ownerUserId }).from(walkGroups).where(eq(walkGroups.id, groupId)).limit(1);
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "グループが見つかりません。" });
  if (group.ownerUserId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "グループ作成者のみ共有内容を確認・管理できます。" });
  }
}

async function createUserBlock(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  blockerUserId: number,
  blockedUserId: number,
) {
  if (blockerUserId === blockedUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "自分自身はブロックできません。" });
  }
  const [existing] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(and(eq(userBlocks.blockerUserId, blockerUserId), eq(userBlocks.blockedUserId, blockedUserId)))
    .limit(1);
  if (!existing) await db.insert(userBlocks).values({ blockerUserId, blockedUserId });
}

function getInsertId(result: unknown): number {
  const value = result as { insertId?: number; 0?: { insertId?: number } };
  return Number(value?.insertId ?? value?.[0]?.insertId ?? 0);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    emailLogin: publicProcedure.input(emailAuthInput).mutation(({ ctx, input }) => loginWithEmail(ctx, input)),
    emailRegister: publicProcedure.input(emailAuthInput).mutation(({ ctx, input }) => registerEmailAccount(ctx, input)),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(getSessionCookieName(ctx.req), { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const db = await requireDb();
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, ctx.user.id)).limit(1);
      let avatarUrl: string | null = null;
      if (profile?.avatarStorageKey) {
        try {
          avatarUrl = await storageGetSignedUrl(profile.avatarStorageKey);
        } catch {
          avatarUrl = null;
        }
      }
      return {
        displayName: profile?.displayName ?? ctx.user.name ?? "",
        avatarUrl,
        email: ctx.user.email,
        emailLoginEnabled: await hasEmailPassword(ctx.user.id),
        role: ctx.user.role,
      };
    }),
    update: protectedProcedure
      .input(z.object({ displayName: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        await db
          .insert(userProfiles)
          .values({ userId: ctx.user.id, displayName: input.displayName })
          .onDuplicateKeyUpdate({ set: { displayName: input.displayName } });
        return { displayName: input.displayName };
      }),
    setEmailPassword: protectedProcedure
      .input(
        z.object({
          email: emailInput.optional(),
          newPassword: passwordInput,
          currentPassword: passwordInput.optional(),
        }),
      )
      .mutation(({ ctx, input }) => setEmailPasswordForUser(ctx, input)),
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      const result = await deleteAccountData(ctx.user.id);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(getSessionCookieName(ctx.req), { ...cookieOptions, maxAge: -1 });
      return { success: true, ...result };
    }),
    pendingStorageDeletions: adminProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select({ requestCode: accountDeletionRequests.requestCode, storageKeys: accountDeletionRequests.storageKeys, requestType: accountDeletionRequests.requestType, requestedAt: accountDeletionRequests.requestedAt })
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.status, "pending_storage_purge"))
        .orderBy(asc(accountDeletionRequests.requestedAt))
        .limit(100);
    }),
    completeStorageDeletion: adminProcedure
      .input(z.object({ requestCode: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const [request] = await db
          .select({ requestCode: accountDeletionRequests.requestCode })
          .from(accountDeletionRequests)
          .where(and(eq(accountDeletionRequests.requestCode, input.requestCode), eq(accountDeletionRequests.status, "pending_storage_purge")))
          .limit(1);
        if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "削除待ちデータが見つかりません。" });
        await db
          .update(accountDeletionRequests)
          .set({ storageKeys: [], status: "completed", completedAt: new Date() })
          .where(eq(accountDeletionRequests.requestCode, input.requestCode));
        return { success: true };
      }),
  }),
  walks: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await requireDb();
      return db
        .select({
          id: walkSessions.id,
          title: walkSessions.title,
          startedAt: walkSessions.startedAt,
          endedAt: walkSessions.endedAt,
          durationSeconds: walkSessions.durationSeconds,
          distanceMeters: walkSessions.distanceMeters,
          averageSpeedMps: walkSessions.averageSpeedMps,
          stepCount: walkSessions.stepCount,
          visibility: walkSessions.visibility,
          groupId: walkSessions.groupId,
        })
        .from(walkSessions)
        .where(eq(walkSessions.userId, ctx.user.id))
        .orderBy(desc(walkSessions.startedAt))
        .limit(100);
    }),
    detail: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await requireDb();
        const [walk] = await db.select().from(walkSessions).where(eq(walkSessions.id, input.id)).limit(1);
        if (!walk) throw new TRPCError({ code: "NOT_FOUND", message: "歩行記録が見つかりません。" });
        if (walk.userId !== ctx.user.id) {
          if (walk.visibility !== "group" || !walk.groupId || walk.moderationStatus !== "approved") {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          await requireGroupMember(db, walk.groupId, ctx.user.id);
          await requireUsersNotBlocked(db, ctx.user.id, walk.userId);
        }
        return walk;
      }),
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().trim().max(120).optional(),
          startedAt: z.number().int().positive(),
          endedAt: z.number().int().positive(),
          durationSeconds: z.number().int().min(1).max(86400),
          distanceMeters: z.number().min(0).max(1000000),
          stepCount: z.number().int().min(0).max(200000),
          visibility: z.enum(["private", "group"]),
          groupId: z.number().int().positive().nullable(),
          routeData: z
            .array(
              z.object({
                latitude: z.number().min(-90).max(90),
                longitude: z.number().min(-180).max(180),
                timestamp: z.number().int().nonnegative(),
                speedMps: z.number().nullable().optional(),
                breakBefore: z.boolean().optional(),
              }),
            )
            .max(5000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        if (input.endedAt <= input.startedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "終了時刻が開始時刻より前です。" });
        }
        let groupId: number | null = null;
        let moderationStatus: "pending" | "approved" = "approved";
        if (input.visibility === "group") {
          if (!input.groupId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "共有するグループを選んでください。" });
          }
          await requireGroupMember(db, input.groupId, ctx.user.id);
          const [group] = await db
            .select({ ownerUserId: walkGroups.ownerUserId })
            .from(walkGroups)
            .where(eq(walkGroups.id, input.groupId))
            .limit(1);
          if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "グループが見つかりません。" });
          await requireUsersNotBlocked(db, ctx.user.id, group.ownerUserId);
          groupId = input.groupId;
          moderationStatus = "pending";
        }
        const averageSpeedMps = input.distanceMeters / input.durationSeconds;
        const result = await db.insert(walkSessions).values({
          userId: ctx.user.id,
          groupId,
          title: input.title || null,
          startedAt: new Date(input.startedAt),
          endedAt: new Date(input.endedAt),
          durationSeconds: input.durationSeconds,
          distanceMeters: input.distanceMeters,
          averageSpeedMps,
          stepCount: input.stepCount,
          visibility: input.visibility,
          moderationStatus,
          routeData: input.routeData as RoutePoint[],
        });
        return { id: getInsertId(result), averageSpeedMps };
      }),
  }),
  spots: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await requireDb();
      const memberships = await db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(eq(groupMembers.userId, ctx.user.id));
      const groupIds = memberships.map((entry) => entry.groupId);
      const blockedUserIds = await getBlockedUserIds(db, ctx.user.id);
      const visibilityFilter = groupIds.length
        ? or(
            eq(visitedSpots.userId, ctx.user.id),
            and(
              eq(visitedSpots.visibility, "group"),
              eq(visitedSpots.moderationStatus, "approved"),
              inArray(visitedSpots.groupId, groupIds),
              ...(blockedUserIds.length ? [notInArray(visitedSpots.userId, blockedUserIds)] : []),
            ),
          )
        : eq(visitedSpots.userId, ctx.user.id);
      const spots = await db
        .select()
        .from(visitedSpots)
        .where(visibilityFilter)
        .orderBy(desc(visitedSpots.visitedAt))
        .limit(200);
      if (!spots.length) return [];
      const photos = await db
        .select({ id: spotPhotos.id, spotId: spotPhotos.spotId })
        .from(spotPhotos)
        .where(inArray(spotPhotos.spotId, spots.map((spot) => spot.id)));
      const photosBySpot = new Map<number, number[]>();
      for (const photo of photos) {
        photosBySpot.set(photo.spotId, [...(photosBySpot.get(photo.spotId) ?? []), photo.id]);
      }
      return spots.map((spot) => ({ ...spot, photos: photosBySpot.get(spot.id) ?? [] }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().trim().min(1).max(120),
          description: z.string().trim().max(4000).optional(),
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          visitedAt: z.number().int().positive(),
          visibility: z.enum(["private", "group"]),
          groupId: z.number().int().positive().nullable(),
          sessionId: z.number().int().positive().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        let groupId: number | null = null;
        let moderationStatus: "pending" | "approved" = "approved";
        if (input.visibility === "group") {
          if (!input.groupId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "共有するグループを選んでください。" });
          }
          await requireGroupMember(db, input.groupId, ctx.user.id);
          const [group] = await db
            .select({ ownerUserId: walkGroups.ownerUserId })
            .from(walkGroups)
            .where(eq(walkGroups.id, input.groupId))
            .limit(1);
          if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "グループが見つかりません。" });
          await requireUsersNotBlocked(db, ctx.user.id, group.ownerUserId);
          groupId = input.groupId;
          moderationStatus = "pending";
        }
        if (input.sessionId) {
          const [walk] = await db
            .select({ id: walkSessions.id })
            .from(walkSessions)
            .where(and(eq(walkSessions.id, input.sessionId), eq(walkSessions.userId, ctx.user.id)))
            .limit(1);
          if (!walk) throw new TRPCError({ code: "NOT_FOUND", message: "関連する歩行記録が見つかりません。" });
        }
        const result = await db.insert(visitedSpots).values({
          userId: ctx.user.id,
          groupId,
          sessionId: input.sessionId ?? null,
          title: input.title,
          description: input.description || null,
          latitude: input.latitude,
          longitude: input.longitude,
          visitedAt: new Date(input.visitedAt),
          visibility: input.visibility,
          moderationStatus,
        });
        return { id: getInsertId(result) };
      }),
  }),
  photos: router({
    signedUrl: protectedProcedure
      .input(z.object({ photoId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await requireDb();
        const [photo] = await db
          .select({
            storageKey: spotPhotos.storageKey,
            ownerUserId: visitedSpots.userId,
            visibility: visitedSpots.visibility,
            groupId: visitedSpots.groupId,
            moderationStatus: visitedSpots.moderationStatus,
          })
          .from(spotPhotos)
          .innerJoin(visitedSpots, eq(spotPhotos.spotId, visitedSpots.id))
          .where(eq(spotPhotos.id, input.photoId))
          .limit(1);
        if (!photo) throw new TRPCError({ code: "NOT_FOUND", message: "写真が見つかりません。" });
        if (photo.ownerUserId !== ctx.user.id) {
          if (photo.visibility !== "group" || !photo.groupId || photo.moderationStatus === "rejected") {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
          await requireGroupMember(db, photo.groupId, ctx.user.id);
          if (photo.moderationStatus === "pending") await requireGroupOwner(db, photo.groupId, ctx.user.id);
          else await requireUsersNotBlocked(db, ctx.user.id, photo.ownerUserId);
        }
        try {
          return { url: await storageGetSignedUrl(photo.storageKey) };
        } catch {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "写真を読み込めませんでした。" });
        }
      }),
    upload: protectedProcedure
      .input(
        z.object({
          base64: z.string().min(1).max(12000000),
          mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
          spotId: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        if (input.spotId) {
          const [spot] = await db
            .select({ id: visitedSpots.id, moderationStatus: visitedSpots.moderationStatus })
            .from(visitedSpots)
            .where(and(eq(visitedSpots.id, input.spotId), eq(visitedSpots.userId, ctx.user.id)))
            .limit(1);
          if (!spot) throw new TRPCError({ code: "FORBIDDEN", message: "このスポットに写真を追加できません。" });
          if (spot.moderationStatus === "rejected") {
            throw new TRPCError({ code: "FORBIDDEN", message: "非公開にされたスポットには写真を追加できません。" });
          }
        }
        const extension = input.mimeType.split("/")[1];
        let avatarStorageKey: string | null = null;
        let previousAvatarStorageKey: string | null = null;
        if (!input.spotId) {
          const [profile] = await db
            .select({ avatarStorageKey: userProfiles.avatarStorageKey })
            .from(userProfiles)
            .where(eq(userProfiles.userId, ctx.user.id))
            .limit(1);
          previousAvatarStorageKey = profile?.avatarStorageKey ?? null;
          avatarStorageKey = previousAvatarStorageKey ?? `machiaru/users/${ctx.user.id}/profile/avatar.${extension}`;
        }
        const keyBase = input.spotId
          ? `machiaru/users/${ctx.user.id}/spots/${input.spotId}-${Date.now()}.${extension}`
          : avatarStorageKey!;
        let stored: { key: string; url: string };
        try {
          stored = await storagePut(keyBase, Buffer.from(input.base64, "base64"), input.mimeType);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "写真を保存できませんでした。通信を確認してもう一度お試しください。",
          });
        }
        if (input.spotId) {
          await db.insert(spotPhotos).values({
            userId: ctx.user.id,
            spotId: input.spotId,
            storageKey: stored.key,
            assetUrl: stored.url,
            mimeType: input.mimeType,
          });
        } else {
          await db.transaction(async (tx) => {
            await tx
              .insert(userProfiles)
              .values({ userId: ctx.user.id, avatarUrl: stored.url, avatarStorageKey: stored.key })
              .onDuplicateKeyUpdate({ set: { avatarUrl: stored.url, avatarStorageKey: stored.key } });
            if (previousAvatarStorageKey && previousAvatarStorageKey !== stored.key) {
              await tx.insert(accountDeletionRequests).values({
                requestCode: randomUUID(),
                storageKeys: [previousAvatarStorageKey],
                requestType: "replaced_profile_photo",
                status: "pending_storage_purge",
              });
            }
          });
        }
        return { success: true };
      }),
  }),
  groups: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await requireDb();
      return db
        .select({
          id: walkGroups.id,
          name: walkGroups.name,
          inviteCode: walkGroups.inviteCode,
          ownerUserId: walkGroups.ownerUserId,
          role: groupMembers.role,
          joinedAt: groupMembers.joinedAt,
        })
        .from(groupMembers)
        .innerJoin(walkGroups, eq(groupMembers.groupId, walkGroups.id))
        .where(eq(groupMembers.userId, ctx.user.id))
        .orderBy(desc(walkGroups.createdAt));
    }),
    create: protectedProcedure
      .input(z.object({ name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const inviteCode = randomBytes(5).toString("hex").toUpperCase();
        return db.transaction(async (tx) => {
          const result = await tx.insert(walkGroups).values({
            ownerUserId: ctx.user.id,
            name: input.name,
            inviteCode,
          });
          const id = getInsertId(result);
          if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "グループを作成できませんでした。" });
          await tx.insert(groupMembers).values({ groupId: id, userId: ctx.user.id, role: "owner" });
          return { id, name: input.name, inviteCode };
        });
      }),
    join: protectedProcedure
      .input(z.object({ inviteCode: z.string().trim().min(6).max(12) }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const [group] = await db
          .select()
          .from(walkGroups)
          .where(eq(walkGroups.inviteCode, input.inviteCode.toUpperCase()))
          .limit(1);
        if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "招待コードを確認できませんでした。" });
        const [existing] = await db
          .select({ id: groupMembers.id })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, ctx.user.id)))
          .limit(1);
        if (!existing) await db.insert(groupMembers).values({ groupId: group.id, userId: ctx.user.id, role: "member" });
        return { id: group.id, name: group.name };
      }),
    members: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupMember(db, input.groupId, ctx.user.id);
        const members = await db
          .select({
            userId: users.id,
            name: users.name,
            displayName: userProfiles.displayName,
            avatarStorageKey: userProfiles.avatarStorageKey,
            role: groupMembers.role,
            joinedAt: groupMembers.joinedAt,
            ownerUserId: walkGroups.ownerUserId,
          })
          .from(groupMembers)
          .innerJoin(users, eq(groupMembers.userId, users.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .innerJoin(walkGroups, eq(groupMembers.groupId, walkGroups.id))
          .where(eq(groupMembers.groupId, input.groupId))
          .orderBy(groupMembers.joinedAt);
        const [outgoingBlocks, incomingBlocks] = await Promise.all([
          db.select({ userId: userBlocks.blockedUserId }).from(userBlocks).where(eq(userBlocks.blockerUserId, ctx.user.id)),
          db.select({ userId: userBlocks.blockerUserId }).from(userBlocks).where(eq(userBlocks.blockedUserId, ctx.user.id)),
        ]);
        const outgoingIds = new Set(outgoingBlocks.map((row) => row.userId));
        const incomingIds = new Set(incomingBlocks.map((row) => row.userId));
        return Promise.all(members.map(async ({ avatarStorageKey, ...member }) => {
          let avatarUrl: string | null = null;
          const isBlocked = outgoingIds.has(member.userId) || incomingIds.has(member.userId);
          if (avatarStorageKey && !isBlocked) {
            try {
              avatarUrl = await storageGetSignedUrl(avatarStorageKey);
            } catch {
              avatarUrl = null;
            }
          }
          return {
            ...member,
            avatarUrl,
            isBlocking: outgoingIds.has(member.userId),
            isBlockedByMember: incomingIds.has(member.userId),
          };
        }));
      }),
    removeMember: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const [group] = await db.select().from(walkGroups).where(eq(walkGroups.id, input.groupId)).limit(1);
        if (!group) throw new TRPCError({ code: "NOT_FOUND" });
        if (group.ownerUserId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "グループ作成者のみメンバーを管理できます。" });
        }
        if (input.userId === group.ownerUserId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "作成者はグループから退出できません。" });
        }
        await db
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.userId)));
        return { success: true };
      }),
    feed: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupMember(db, input.groupId, ctx.user.id);
        const blockedUserIds = await getBlockedUserIds(db, ctx.user.id);
        const walks = await db
          .select({
            id: walkSessions.id,
            title: walkSessions.title,
            startedAt: walkSessions.startedAt,
            durationSeconds: walkSessions.durationSeconds,
            distanceMeters: walkSessions.distanceMeters,
            stepCount: walkSessions.stepCount,
            routeData: walkSessions.routeData,
            userId: walkSessions.userId,
            displayName: userProfiles.displayName,
            name: users.name,
          })
          .from(walkSessions)
          .innerJoin(users, eq(walkSessions.userId, users.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .where(
            and(
              eq(walkSessions.groupId, input.groupId),
              eq(walkSessions.visibility, "group"),
              eq(walkSessions.moderationStatus, "approved"),
              ...(blockedUserIds.length ? [notInArray(walkSessions.userId, blockedUserIds)] : []),
            ),
          )
          .orderBy(desc(walkSessions.startedAt))
          .limit(20);
        const spots = await db
          .select({
            id: visitedSpots.id,
            title: visitedSpots.title,
            description: visitedSpots.description,
            latitude: visitedSpots.latitude,
            longitude: visitedSpots.longitude,
            visitedAt: visitedSpots.visitedAt,
            userId: visitedSpots.userId,
            displayName: userProfiles.displayName,
            name: users.name,
          })
          .from(visitedSpots)
          .innerJoin(users, eq(visitedSpots.userId, users.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .where(
            and(
              eq(visitedSpots.groupId, input.groupId),
              eq(visitedSpots.visibility, "group"),
              eq(visitedSpots.moderationStatus, "approved"),
              ...(blockedUserIds.length ? [notInArray(visitedSpots.userId, blockedUserIds)] : []),
            ),
          )
          .orderBy(desc(visitedSpots.visitedAt))
          .limit(30);
        const photos = spots.length
          ? await db
              .select({ id: spotPhotos.id, spotId: spotPhotos.spotId })
              .from(spotPhotos)
              .where(inArray(spotPhotos.spotId, spots.map((spot) => spot.id)))
          : [];
        const photosBySpot = new Map<number, number[]>();
        for (const photo of photos) {
          photosBySpot.set(photo.spotId, [...(photosBySpot.get(photo.spotId) ?? []), photo.id]);
        }
        return {
          walks: walks.map((walk) => ({
            ...walk,
            author: walk.displayName || walk.name || "まちあるメンバー",
          })),
          spots: spots.map((spot) => ({
            ...spot,
            author: spot.displayName || spot.name || "まちあるメンバー",
            photos: photosBySpot.get(spot.id) ?? [],
          })),
        };
      }),
    pendingContent: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupOwner(db, input.groupId, ctx.user.id);
        const walks = await db
          .select({
            id: walkSessions.id,
            title: walkSessions.title,
            startedAt: walkSessions.startedAt,
            durationSeconds: walkSessions.durationSeconds,
            distanceMeters: walkSessions.distanceMeters,
            stepCount: walkSessions.stepCount,
            routeData: walkSessions.routeData,
            userId: walkSessions.userId,
            displayName: userProfiles.displayName,
            name: users.name,
          })
          .from(walkSessions)
          .innerJoin(users, eq(walkSessions.userId, users.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .where(and(eq(walkSessions.groupId, input.groupId), eq(walkSessions.moderationStatus, "pending")))
          .orderBy(desc(walkSessions.startedAt))
          .limit(50);
        const spots = await db
          .select({
            id: visitedSpots.id,
            title: visitedSpots.title,
            description: visitedSpots.description,
            latitude: visitedSpots.latitude,
            longitude: visitedSpots.longitude,
            visitedAt: visitedSpots.visitedAt,
            userId: visitedSpots.userId,
            displayName: userProfiles.displayName,
            name: users.name,
          })
          .from(visitedSpots)
          .innerJoin(users, eq(visitedSpots.userId, users.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .where(and(eq(visitedSpots.groupId, input.groupId), eq(visitedSpots.moderationStatus, "pending")))
          .orderBy(desc(visitedSpots.visitedAt))
          .limit(50);
        const photos = spots.length
          ? await db
              .select({ id: spotPhotos.id, spotId: spotPhotos.spotId })
              .from(spotPhotos)
              .where(inArray(spotPhotos.spotId, spots.map((spot) => spot.id)))
          : [];
        const photosBySpot = new Map<number, number[]>();
        for (const photo of photos) photosBySpot.set(photo.spotId, [...(photosBySpot.get(photo.spotId) ?? []), photo.id]);
        return {
          walks: walks.map(({ displayName, name, ...walk }) => ({
            ...walk,
            author: displayName || name || "まちあるメンバー",
          })),
          spots: spots.map(({ displayName, name, ...spot }) => ({
            ...spot,
            author: displayName || name || "まちあるメンバー",
            photos: photosBySpot.get(spot.id) ?? [],
          })),
        };
      }),
    openReports: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupOwner(db, input.groupId, ctx.user.id);
        const reports = await db
          .select()
          .from(moderationReports)
          .where(and(eq(moderationReports.groupId, input.groupId), eq(moderationReports.status, "open")))
          .orderBy(desc(moderationReports.createdAt))
          .limit(100);
        return Promise.all(reports.map(async (report) => {
          const [reporter] = report.reporterUserId
            ? await db.select({ name: userProfiles.displayName, fallbackName: users.name }).from(users)
                .leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, report.reporterUserId)).limit(1)
            : [];
          const [target] = report.targetUserId
            ? await db.select({ name: userProfiles.displayName, fallbackName: users.name }).from(users)
                .leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, report.targetUserId)).limit(1)
            : [];
          return {
            ...report,
            reporterName: reporter?.name || reporter?.fallbackName || "削除済み利用者",
            targetName: target?.name || target?.fallbackName || "利用者情報なし",
          };
        }));
      }),
    reportContent: protectedProcedure
      .input(z.object({
        groupId: z.number().int().positive(),
        targetType: z.enum(["walk", "spot", "user"]),
        targetId: z.number().int().positive(),
        reason: z.enum(["inappropriate", "harassment", "privacy", "spam", "other"]),
        details: z.string().trim().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupMember(db, input.groupId, ctx.user.id);
        let targetUserId: number | null = null;
        if (input.targetType === "user") {
          if (input.targetId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "自分自身は通報できません。" });
          await requireGroupMember(db, input.groupId, input.targetId);
          targetUserId = input.targetId;
        } else if (input.targetType === "walk") {
          const [target] = await db
            .select({ userId: walkSessions.userId })
            .from(walkSessions)
            .where(and(
              eq(walkSessions.id, input.targetId),
              eq(walkSessions.groupId, input.groupId),
              eq(walkSessions.visibility, "group"),
              eq(walkSessions.moderationStatus, "approved"),
            ))
            .limit(1);
          if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "共有記録が見つかりません。" });
          if (target.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "自分の投稿は通報できません。" });
          targetUserId = target.userId;
        } else {
          const [target] = await db
            .select({ userId: visitedSpots.userId })
            .from(visitedSpots)
            .where(and(
              eq(visitedSpots.id, input.targetId),
              eq(visitedSpots.groupId, input.groupId),
              eq(visitedSpots.visibility, "group"),
              eq(visitedSpots.moderationStatus, "approved"),
            ))
            .limit(1);
          if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "共有スポットが見つかりません。" });
          if (target.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "自分の投稿は通報できません。" });
          targetUserId = target.userId;
        }
        const [existing] = await db
          .select({ id: moderationReports.id })
          .from(moderationReports)
          .where(and(
            eq(moderationReports.groupId, input.groupId),
            eq(moderationReports.reporterUserId, ctx.user.id),
            eq(moderationReports.targetType, input.targetType),
            eq(moderationReports.targetId, input.targetId),
            eq(moderationReports.status, "open"),
          ))
          .limit(1);
        if (existing) return { success: true, alreadyReported: true };
        await db.insert(moderationReports).values({
          groupId: input.groupId,
          reporterUserId: ctx.user.id,
          targetUserId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          details: input.details || null,
        });
        return { success: true, alreadyReported: false };
      }),
    reviewContent: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive(), targetType: z.enum(["walk", "spot"]), targetId: z.number().int().positive(), decision: z.enum(["approve", "reject"]) }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupOwner(db, input.groupId, ctx.user.id);
        const targetTable = input.targetType === "walk" ? walkSessions : visitedSpots;
        const [target] = await db
          .select({ id: targetTable.id })
          .from(targetTable)
          .where(and(eq(targetTable.id, input.targetId), eq(targetTable.groupId, input.groupId), eq(targetTable.moderationStatus, "pending")))
          .limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "確認待ちの投稿が見つかりません。" });
        await db.update(targetTable)
          .set({ moderationStatus: input.decision === "approve" ? "approved" : "rejected" })
          .where(eq(targetTable.id, input.targetId));
        return { success: true };
      }),
    resolveReport: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive(), reportId: z.number().int().positive(), decision: z.enum(["dismiss", "remove", "block"]) }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupOwner(db, input.groupId, ctx.user.id);
        const [report] = await db
          .select()
          .from(moderationReports)
          .where(and(eq(moderationReports.id, input.reportId), eq(moderationReports.groupId, input.groupId), eq(moderationReports.status, "open")))
          .limit(1);
        if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "未対応の通報が見つかりません。" });
        if (input.decision === "remove") {
          if (report.targetType === "walk") {
            await db.update(walkSessions).set({ moderationStatus: "rejected" })
              .where(and(eq(walkSessions.id, report.targetId), eq(walkSessions.groupId, input.groupId)));
          } else if (report.targetType === "spot") {
            await db.update(visitedSpots).set({ moderationStatus: "rejected" })
              .where(and(eq(visitedSpots.id, report.targetId), eq(visitedSpots.groupId, input.groupId)));
          } else {
            throw new TRPCError({ code: "BAD_REQUEST", message: "利用者への対応にはブロックを選んでください。" });
          }
        }
        if (input.decision === "block") {
          if (!report.targetUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "対象利用者を特定できません。" });
          await createUserBlock(db, ctx.user.id, report.targetUserId);
        }
        await db.update(moderationReports).set({
          status: input.decision === "dismiss" ? "dismissed" : "resolved",
          resolution: input.decision,
          moderatorUserId: ctx.user.id,
          resolvedAt: new Date(),
        }).where(eq(moderationReports.id, input.reportId));
        return { success: true };
      }),
    blockMember: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupMember(db, input.groupId, ctx.user.id);
        await requireGroupMember(db, input.groupId, input.userId);
        await createUserBlock(db, ctx.user.id, input.userId);
        return { success: true };
      }),
    unblockMember: protectedProcedure
      .input(z.object({ groupId: z.number().int().positive(), userId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        await requireGroupMember(db, input.groupId, ctx.user.id);
        await db.delete(userBlocks).where(and(eq(userBlocks.blockerUserId, ctx.user.id), eq(userBlocks.blockedUserId, input.userId)));
        return { success: true };
      }),
    }),
  map: router({
    image: protectedProcedure
      .input(
        z.object({
          center: z.object({
            latitude: z.number().min(-85).max(85),
            longitude: z.number().min(-180).max(180),
          }),
          zoom: z.number().int().min(3).max(19),
          size: z.object({
            width: z.number().int().min(1).max(640),
            height: z.number().int().min(1).max(640),
          }),
          routePoints: z
            .array(
              z.object({
                latitude: z.number().min(-90).max(90),
                longitude: z.number().min(-180).max(180),
                timestamp: z.number().int().nonnegative(),
                speedMps: z.number().nullable().optional(),
              }),
            )
            .max(5000)
            .default([]),
          markers: z
            .array(
              z.object({
                latitude: z.number().min(-90).max(90),
                longitude: z.number().min(-180).max(180),
              }),
            )
            .max(200)
            .default([]),
        }),
      )
      .query(async ({ input }) => {
        try {
          return await fetchStaticMap(input);
        } catch {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "地図を読み込めませんでした。少し待ってから再読み込みしてください。",
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
