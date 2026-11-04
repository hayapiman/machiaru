import { describe, expect, it } from "vitest";
import { areUsersBlocked, getBlockedUserIds, requireUsersNotBlocked } from "../server/moderation";

type BlockRow = { id: number; blockerUserId: number; blockedUserId: number };

function listDatabase(rows: BlockRow[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  } as never;
}

function firstRowDatabase(row: BlockRow | undefined) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => row ? [row] : [] }),
      }),
    }),
  } as never;
}

describe("user block safeguards", () => {
  it("returns blocked peers whether the user created or received a block", async () => {
    const db = listDatabase([
      { id: 1, blockerUserId: 7, blockedUserId: 2 },
      { id: 2, blockerUserId: 3, blockedUserId: 7 },
      { id: 3, blockerUserId: 7, blockedUserId: 2 },
    ]);

    await expect(getBlockedUserIds(db, 7)).resolves.toEqual([2, 3]);
  });

  it("rejects access when a block exists in either direction", async () => {
    const db = firstRowDatabase({ id: 1, blockerUserId: 2, blockedUserId: 7 });

    await expect(areUsersBlocked(db, 7, 2)).resolves.toBe(true);
    await expect(requireUsersNotBlocked(db, 7, 2)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows access when no block exists", async () => {
    const db = firstRowDatabase(undefined);

    await expect(areUsersBlocked(db, 7, 2)).resolves.toBe(false);
    await expect(requireUsersNotBlocked(db, 7, 2)).resolves.toBeUndefined();
  });
});
