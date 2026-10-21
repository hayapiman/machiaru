import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const DUMMY_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"00".repeat(16)}$${"00".repeat(KEY_LENGTH)}`;

type AttemptBucket = { count: number; resetAt: number };
const attemptsByEmailHash = new Map<string, AttemptBucket>();

function emailAttemptKey(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: MAX_MEMORY_BYTES,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string | null | undefined,
): Promise<boolean> {
  const hashToCheck = encodedHash ?? DUMMY_HASH;
  const parts = hashToCheck.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, keyHex] = parts;
  if (
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !/^[0-9a-f]{32}$/i.test(saltHex) ||
    !/^[0-9a-f]{128}$/i.test(keyHex)
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = await deriveKey(password, Buffer.from(saltHex, "hex"));
    const matches = timingSafeEqual(actual, expected);
    return Boolean(encodedHash) && matches;
  } catch {
    return false;
  }
}

export function assertEmailAuthAllowed(email: string, now = Date.now()): void {
  const key = emailAttemptKey(email);
  const bucket = attemptsByEmailHash.get(key);
  if (!bucket) return;
  if (now >= bucket.resetAt) {
    attemptsByEmailHash.delete(key);
    return;
  }
  if (bucket.count >= ATTEMPT_LIMIT) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "試行回数が多すぎます。15分ほど待ってからもう一度お試しください。",
    });
  }
}

export function recordEmailAuthFailure(email: string, now = Date.now()): void {
  const key = emailAttemptKey(email);
  const bucket = attemptsByEmailHash.get(key);
  if (!bucket || now >= bucket.resetAt) {
    attemptsByEmailHash.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  } else {
    bucket.count += 1;
  }

  if (attemptsByEmailHash.size > 10_000) {
    for (const [attemptKey, attempt] of attemptsByEmailHash) {
      if (now >= attempt.resetAt) attemptsByEmailHash.delete(attemptKey);
    }
  }
}

export function clearEmailAuthFailures(email: string): void {
  attemptsByEmailHash.delete(emailAttemptKey(email));
}

export function resetEmailAuthFailuresForTests(): void {
  attemptsByEmailHash.clear();
}
