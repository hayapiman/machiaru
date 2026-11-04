import { and, eq, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { userBlocks } from "../drizzle/schema";
import { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function getBlockedUserIds(db: Database, userId: number): Promise<number[]> {
  const rows = await db
    .select({ blockerUserId: userBlocks.blockerUserId, blockedUserId: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, userId)));
  return [...new Set(rows.flatMap((row) => [row.blockerUserId, row.blockedUserId]))].filter((id) => id !== userId);
}

export async function areUsersBlocked(db: Database, firstUserId: number, secondUserId: number): Promise<boolean> {
  const [block] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerUserId, firstUserId), eq(userBlocks.blockedUserId, secondUserId)),
        and(eq(userBlocks.blockerUserId, secondUserId), eq(userBlocks.blockedUserId, firstUserId)),
      ),
    )
    .limit(1);
  return Boolean(block);
}

export async function requireUsersNotBlocked(db: Database, firstUserId: number, secondUserId: number) {
  if (await areUsersBlocked(db, firstUserId, secondUserId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ブロック中の利用者の共有内容は表示できません。" });
  }
}
