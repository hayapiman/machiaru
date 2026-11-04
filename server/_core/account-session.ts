import { createHmac } from "node:crypto";

/** Return a non-reversible, server-secret keyed fingerprint for session revocation. */
export function hashDeletedSessionOpenId(openId: string, secret: string): string {
  if (!secret) throw new Error("Session signing secret is required to revoke an account session.");
  return createHmac("sha256", secret).update(openId, "utf8").digest("hex");
}
