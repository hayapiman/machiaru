import { and, desc, eq, inArray, or } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  groupMembers,
  spotPhotos,
  userProfiles,
  users,
  visitedSpots,
  walkGroups,
  walkSessions,
  type RoutePoint,
} from "../drizzle/schema";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { hasEmailPassword, loginWithEmail, registerEmailAccount, setEmailPasswordForUser } from "./email-auth";
import { fetchStaticMap } from "./map-service";
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
          newPassword: passwordInput,
          currentPassword: passwordInput.optional(),
        }),
      )
      .mutation(({ ctx, input }) => setEmailPasswordForUser(ctx, input)),
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
          if (walk.visibility !== "group" || !walk.groupId) throw new TRPCError({ code: "FORBIDDEN" });
          await requireGroupMember(db, walk.groupId, ctx.user.id);
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
        if (input.visibility === "group") {
          if (!input.groupId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "共有するグループを選んでください。" });
          }
          await requireGroupMember(db, input.groupId, ctx.user.id);
          groupId = input.groupId;
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
      const visibilityFilter = groupIds.length
        ? or(
            eq(visitedSpots.userId, ctx.user.id),
            and(eq(visitedSpots.visibility, "group"), inArray(visitedSpots.groupId, groupIds)),
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
        if (input.visibility === "group") {
          if (!input.groupId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "共有するグループを選んでください。" });
          }
          await requireGroupMember(db, input.groupId, ctx.user.id);
          groupId = input.groupId;
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
          })
          .from(spotPhotos)
          .innerJoin(visitedSpots, eq(spotPhotos.spotId, visitedSpots.id))
          .where(eq(spotPhotos.id, input.photoId))
          .limit(1);
        if (!photo) throw new TRPCError({ code: "NOT_FOUND", message: "写真が見つかりません。" });
        if (photo.ownerUserId !== ctx.user.id) {
          if (photo.visibility !== "group" || !photo.groupId) throw new TRPCError({ code: "FORBIDDEN" });
          await requireGroupMember(db, photo.groupId, ctx.user.id);
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
            .select({ id: visitedSpots.id })
            .from(visitedSpots)
            .where(and(eq(visitedSpots.id, input.spotId), eq(visitedSpots.userId, ctx.user.id)))
            .limit(1);
          if (!spot) throw new TRPCError({ code: "FORBIDDEN", message: "このスポットに写真を追加できません。" });
        }
        const extension = input.mimeType.split("/")[1];
        const keyBase = input.spotId
          ? `machiaru/users/${ctx.user.id}/spots/${input.spotId}-${Date.now()}.${extension}`
          : `machiaru/users/${ctx.user.id}/profile/avatar-${Date.now()}.${extension}`;
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
          await db
            .insert(userProfiles)
            .values({ userId: ctx.user.id, avatarUrl: stored.url, avatarStorageKey: stored.key })
            .onDuplicateKeyUpdate({ set: { avatarUrl: stored.url, avatarStorageKey: stored.key } });
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
        return Promise.all(members.map(async ({ avatarStorageKey, ...member }) => {
          let avatarUrl: string | null = null;
          if (avatarStorageKey) {
            try {
              avatarUrl = await storageGetSignedUrl(avatarStorageKey);
            } catch {
              avatarUrl = null;
            }
          }
          return { ...member, avatarUrl };
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
          .where(and(eq(walkSessions.groupId, input.groupId), eq(walkSessions.visibility, "group")))
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
          .where(and(eq(visitedSpots.groupId, input.groupId), eq(visitedSpots.visibility, "group")))
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
