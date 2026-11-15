import "server-only";

import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  initializeLoginRateLimitSchema,
} from "./login-rate-limit-db";

export interface StoredSession {
  tokenHash: string;
  jellyfinUserId: string;
  createdAt: number;
  expiresAt: number;
  encryptedJellyfinToken?: string | null;
}

export function openSessionDatabase(
  databasePath: string,
): DatabaseSync {
  if (!databasePath || databasePath === ":memory:") {
    throw new Error("A persistent session database path is required.");
  }

  const absolutePath = resolve(databasePath);

  const directory = dirname(absolutePath);

  mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });

  const directoryStat = lstatSync(directory);

  if (
    !directoryStat.isDirectory() ||
    directoryStat.uid !== process.getuid?.() ||
    (directoryStat.mode & 0o077) !== 0
  ) {
    throw new Error("Session database directory must be private.");
  }

  if (existsSync(absolutePath)) {
    const databaseStat = lstatSync(absolutePath);

    if (
      !databaseStat.isFile() ||
      databaseStat.uid !== process.getuid?.() ||
      (databaseStat.mode & 0o077) !== 0
    ) {
      throw new Error("Session database file must be private.");
    }
  } else {
    const descriptor = openSync(
      absolutePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );

    closeSync(descriptor);
  }

  const database = new DatabaseSync(absolutePath, {
    timeout: 5000,
  });

  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        jellyfin_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        encrypted_jellyfin_token TEXT,
        CHECK (expires_at > created_at)
      );

      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
      ON sessions(expires_at);
    `);

    initializeLoginRateLimitSchema(database);

    const columns = database.prepare(
      "PRAGMA table_info(sessions)",
    ).all() as Array<{ name: string }>;

    if (
      !columns.some(
        (column) => column.name === "encrypted_jellyfin_token",
      )
    ) {
      database.exec(
        "ALTER TABLE sessions ADD COLUMN encrypted_jellyfin_token TEXT",
      );
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function insertSession(
  database: DatabaseSync,
  session: StoredSession,
): void {
  if (
    !/^[a-f0-9]{64}$/.test(session.tokenHash) ||
    !session.jellyfinUserId ||
    !Number.isSafeInteger(session.createdAt) ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt <= session.createdAt ||
    (
      session.encryptedJellyfinToken != null &&
      (
        typeof session.encryptedJellyfinToken !== "string" ||
        !/^v1:[a-f0-9]{24}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/.test(
          session.encryptedJellyfinToken,
        ) ||
        session.encryptedJellyfinToken.length > 16484
      )
    )
  ) {
    throw new Error("Invalid session record.");
  }

  database.prepare(`
    INSERT INTO sessions (
      token_hash,
      jellyfin_user_id,
      created_at,
      expires_at,
      encrypted_jellyfin_token
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    session.tokenHash,
    session.jellyfinUserId,
    session.createdAt,
    session.expiresAt,
    session.encryptedJellyfinToken ?? null,
  );
}

export function findSession(
  database: DatabaseSync,
  tokenHash: string,
  now: number,
): StoredSession | null {
  if (
    !/^[a-f0-9]{64}$/.test(tokenHash) ||
    !Number.isSafeInteger(now)
  ) {
    return null;
  }

  const row = database.prepare(`
    SELECT
      token_hash AS tokenHash,
      jellyfin_user_id AS jellyfinUserId,
      created_at AS createdAt,
      expires_at AS expiresAt,
      encrypted_jellyfin_token AS encryptedJellyfinToken
    FROM sessions
    WHERE token_hash = ?
      AND expires_at > ?
  `).get(tokenHash, now);

  return (row as unknown as StoredSession | undefined) ?? null;
}

export function deleteSession(
  database: DatabaseSync,
  tokenHash: string,
): void {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new Error("Invalid session token hash.");
  }

  database.prepare(`
    DELETE FROM sessions
    WHERE token_hash = ?
  `).run(tokenHash);
}

export function deleteExpiredSessions(
  database: DatabaseSync,
  now: number,
): number {
  if (!Number.isSafeInteger(now)) {
    throw new Error("Invalid expiration timestamp.");
  }

  const result = database.prepare(`
    DELETE FROM sessions
    WHERE expires_at <= ?
  `).run(now);

  return Number(result.changes);
}
