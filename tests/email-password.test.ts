import { afterEach, describe, expect, it } from "vitest";
import {
  assertEmailAuthAllowed,
  clearEmailAuthFailures,
  hashPassword,
  normalizeEmail,
  recordEmailAuthFailure,
  resetEmailAuthFailuresForTests,
  verifyPassword,
} from "../server/_core/email-password";

afterEach(() => resetEmailAuthFailuresForTests());

describe("email password helpers", () => {
  it("normalizes email addresses consistently", () => {
    expect(normalizeEmail("  WALKER@Example.COM ")).toBe("walker@example.com");
  });

  it("stores a unique salted scrypt hash and verifies only the matching password", async () => {
    const first = await hashPassword("correct-horse-battery-staple");
    const second = await hashPassword("correct-horse-battery-staple");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword("correct-horse-battery-staple", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", first)).resolves.toBe(false);
  });

  it("performs a dummy scrypt check for unknown users and rejects malformed hashes", async () => {
    await expect(verifyPassword("some-password", undefined)).resolves.toBe(false);
    await expect(verifyPassword("some-password", "plain-text-password")).resolves.toBe(false);
  });

  it("limits repeated failures by normalized email and clears the limit after success", () => {
    const now = 1_800_000_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordEmailAuthFailure("Walker@Example.com", now);
    }
    expect(() => assertEmailAuthAllowed(" walker@example.com ", now + 1)).toThrow(
      "試行回数が多すぎます",
    );

    clearEmailAuthFailures("walker@example.com");
    expect(() => assertEmailAuthAllowed("walker@example.com", now + 1)).not.toThrow();
  });

  it("expires the attempt window after fifteen minutes", () => {
    const now = 1_800_000_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordEmailAuthFailure("walker@example.com", now);
    }
    expect(() => assertEmailAuthAllowed("walker@example.com", now + 15 * 60 * 1000)).not.toThrow();
  });
});
