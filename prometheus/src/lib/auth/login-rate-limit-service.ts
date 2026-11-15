import "server-only";

import { openSessionDatabase } from "./session-db";

import {
  consumeLoginRateLimitAttempt,
  purgeExpiredLoginRateLimits,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  type LoginRateLimitResult,
} from "./login-rate-limit-db";

import {
  createLoginRateLimitIdentifier,
} from "./login-rate-limit-identity";

export interface LoginRateLimitDecision
  extends LoginRateLimitResult {
  maxAttempts: number;
  windowMs: number;
}

export class LoginRateLimitServiceError extends Error {
  constructor() {
    super("Login rate-limit verification unavailable.");

    this.name = "LoginRateLimitServiceError";
  }
}

function getDatabasePath(): string {
  const databasePath =
    process.env.PROMETHEUS_SESSION_DB_PATH;

  if (
    typeof databasePath !== "string" ||
    databasePath.trim().length === 0
  ) {
    throw new Error(
      "PROMETHEUS_SESSION_DB_PATH is required.",
    );
  }

  return databasePath;
}

/**
 * Consumes one account-level login attempt.
 *
 * This function must be called before contacting Jellyfin.
 *
 * A database or configuration failure throws rather than
 * returning an allowed decision.
 *
 * IP-based restrictions must be implemented separately
 * after establishing a trusted client-address source.
 */
export function consumeAccountLoginAttempt(
  username: string,
  now: number = Date.now(),
): LoginRateLimitDecision {
  try {
    // Validate and hash before opening the database.
    // This prevents invalid requests from creating
    // persistent database files.
    const identifier =
      createLoginRateLimitIdentifier(
        "account",
        username,
      );

    if (
      !Number.isSafeInteger(now) ||
      now < 0
    ) {
      throw new Error(
        "Invalid login rate-limit timestamp.",
      );
    }

    const databasePath = getDatabasePath();

    const database =
      openSessionDatabase(databasePath);

    try {
      const result =
        consumeLoginRateLimitAttempt(
          database,
          identifier,
          now,
        );

      // Cleanup occurs only after the current attempt
      // has been evaluated and committed.
      //
      // If cleanup fails, authentication fails closed.
      purgeExpiredLoginRateLimits(database, now);

      return {
        ...result,
        maxAttempts:
          LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
        windowMs:
          LOGIN_RATE_LIMIT_WINDOW_MS,
      };
    } finally {
      database.close();
    }
  } catch {
    // Do not expose database paths, secrets,
    // SQLite errors or account information.
    //
    // Callers must reject authentication when
    // this exception is raised.
    throw new LoginRateLimitServiceError();
  }
}
