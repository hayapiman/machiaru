import { describe, expect, it } from "vitest";
import { hashDeletedSessionOpenId } from "../server/_core/account-session";

describe("deleted account session fingerprint", () => {
  it("returns a stable SHA-256-sized keyed fingerprint without storing the openId", () => {
    const openId = "legacy-user-open-id-123";
    const fingerprint = hashDeletedSessionOpenId(openId, "test-only-secret");

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain(openId);
    expect(hashDeletedSessionOpenId(openId, "test-only-secret")).toBe(fingerprint);
  });

  it("cannot be matched using a different server secret", () => {
    expect(hashDeletedSessionOpenId("email_abc123", "secret-one"))
      .not.toBe(hashDeletedSessionOpenId("email_abc123", "secret-two"));
  });

  it("fails closed when the server signing secret is missing", () => {
    expect(() => hashDeletedSessionOpenId("legacy-id", "")).toThrow("Session signing secret is required");
  });
});
