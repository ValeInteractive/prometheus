import "server-only";

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "prometheus_session";

export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export interface AuthenticatedSession {
  id: string;
  jellyfinUserId: string;
  jellyfinUsername: string;
  createdAt: Date;
  expiresAt: Date;
}

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("hex");
}

export function isValidSessionToken(
  token: unknown,
): token is string {
  return (
    typeof token === "string" &&
    SESSION_TOKEN_PATTERN.test(token)
  );
}

export function hashSessionToken(token: string): string {
  if (!isValidSessionToken(token)) {
    throw new Error("Invalid session token.");
  }

  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

export function sessionTokenHashesMatch(
  firstHash: string,
  secondHash: string,
): boolean {
  if (
    !SESSION_TOKEN_PATTERN.test(firstHash) ||
    !SESSION_TOKEN_PATTERN.test(secondHash)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(firstHash, "hex"),
    Buffer.from(secondHash, "hex"),
  );
}

export function createSessionExpiry(
  now: Date = new Date(),
): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Invalid session timestamp.");
  }

  return new Date(
    now.getTime() + SESSION_DURATION_MS,
  );
}

export function isSessionExpired(
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    !Number.isFinite(now.getTime())
  ) {
    return true;
  }

  return expiresAt.getTime() <= now.getTime();
}
