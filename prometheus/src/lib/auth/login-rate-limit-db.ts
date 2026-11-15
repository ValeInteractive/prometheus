import "server-only";

import type { DatabaseSync } from "node:sqlite";

export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;

const IDENTIFIER_PATTERN = /^[a-f0-9]{64}$/;

export interface LoginRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface RateLimitRow {
  attempts: number;
  windowStart: number;
}

function validateInput(
  identifier: string,
  now: number,
): void {
  if (
    typeof identifier !== "string" ||
    !IDENTIFIER_PATTERN.test(identifier) ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    throw new Error("Invalid rate-limit input.");
  }
}

export function initializeLoginRateLimitSchema(
  database: DatabaseSync,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      identifier_hash TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      CHECK (attempts >= 0),
      CHECK (window_start >= 0)
    );

    CREATE INDEX IF NOT EXISTS login_rate_limits_window_idx
    ON login_rate_limits(window_start);
  `);
}

export function consumeLoginRateLimitAttempt(
  database: DatabaseSync,
  identifier: string,
  now: number = Date.now(),
): LoginRateLimitResult {
  validateInput(identifier, now);

  database.exec("BEGIN IMMEDIATE");

  try {
    const row = database.prepare(`
      SELECT
        attempts,
        window_start AS windowStart
      FROM login_rate_limits
      WHERE identifier_hash = ?
    `).get(identifier) as unknown as
      | RateLimitRow
      | undefined;

    if (
      !row ||
      (
        now >= row.windowStart &&
        now - row.windowStart >= LOGIN_RATE_LIMIT_WINDOW_MS
      )
    ) {
      database.prepare(`
        INSERT INTO login_rate_limits (
          identifier_hash,
          attempts,
          window_start
        )
        VALUES (?, 1, ?)
        ON CONFLICT(identifier_hash)
        DO UPDATE SET
          attempts = 1,
          window_start = excluded.window_start
      `).run(identifier, now);

      database.exec("COMMIT");

      return {
        allowed: true,
        remaining: LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 1,
        retryAfterMs: 0,
      };
    }

    if (row.attempts >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfterMs = Math.max(
        0,
        LOGIN_RATE_LIMIT_WINDOW_MS - (now - row.windowStart),
      );

      database.exec("COMMIT");

      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
      };
    }

    const nextAttempts = row.attempts + 1;

    database.prepare(`
      UPDATE login_rate_limits
      SET attempts = ?
      WHERE identifier_hash = ?
    `).run(nextAttempts, identifier);

    database.exec("COMMIT");

    return {
      allowed: true,
      remaining: Math.max(
        0,
        LOGIN_RATE_LIMIT_MAX_ATTEMPTS - nextAttempts,
      ),
      retryAfterMs: 0,
    };
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }

    throw error;
  }
}

export function purgeExpiredLoginRateLimits(
  database: DatabaseSync,
  now: number = Date.now(),
): number {
  if (
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    throw new Error("Invalid rate-limit cleanup timestamp.");
  }

  const result = database.prepare(`
    DELETE FROM login_rate_limits
    WHERE window_start <= ?
  `).run(now - LOGIN_RATE_LIMIT_WINDOW_MS);

  return Number(result.changes);
}
