import "server-only";

import type { DatabaseSync } from "node:sqlite";

import {
  decryptJellyfinAccessToken,
  encryptJellyfinAccessToken,
} from "./token-encryption";

import {
  deleteExpiredSessions,
  deleteSession,
  findSession,
  insertSession,
  openSessionDatabase,
  type StoredSession,
} from "./session-db";

import {
  createSessionExpiry,
  createSessionToken,
  hashSessionToken,
  isValidSessionToken,
} from "./session-security";

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export interface ActiveSession {
  jellyfinUserId: string;
  createdAt: Date;
  expiresAt: Date;
}

function getSessionDatabasePath(): string {
  const configured = process.env.PROMETHEUS_SESSION_DB_PATH;

  if (!configured) {
    throw new Error("PROMETHEUS_SESSION_DB_PATH is not configured.");
  }

  return configured;
}

function withSessionDatabase<T>(
  operation: (database: DatabaseSync) => T,
): T {
  const database = openSessionDatabase(getSessionDatabasePath());

  try {
    return operation(database);
  } finally {
    database.close();
  }
}

export function createAuthenticatedSession(
  jellyfinUserId: string,
  accessToken: string,
  now: Date = new Date(),
): CreatedSession {
  if (
    typeof jellyfinUserId !== "string" ||
    !jellyfinUserId.trim() ||
    jellyfinUserId.length > 128 ||
    typeof accessToken !== "string" ||
    !accessToken ||
    !Number.isSafeInteger(now.getTime())
  ) {
    throw new Error("Invalid session creation input.");
  }

  const encryptedJellyfinToken = encryptJellyfinAccessToken(
    accessToken,
    jellyfinUserId,
  );

  const token = createSessionToken();
  const expiresAt = createSessionExpiry(now);

  const session: StoredSession = {
    tokenHash: hashSessionToken(token),
    jellyfinUserId,
    createdAt: now.getTime(),
    expiresAt: expiresAt.getTime(),
    encryptedJellyfinToken,
  };

  withSessionDatabase((database) => {
    insertSession(database, session);
  });

  return {
    token,
    expiresAt,
  };
}

export function getAuthenticatedSession(
  token: unknown,
  now: Date = new Date(),
): ActiveSession | null {
  if (
    !isValidSessionToken(token) ||
    !Number.isSafeInteger(now.getTime())
  ) {
    return null;
  }

  const session = withSessionDatabase((database) => {
    return findSession(
      database,
      hashSessionToken(token),
      now.getTime(),
    );
  });

  if (!session) {
    return null;
  }

  return {
    jellyfinUserId: session.jellyfinUserId,
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
  };
}

export function getAuthenticatedJellyfinAccessToken(
  token: unknown,
  now: Date = new Date(),
): string | null {
  if (
    !isValidSessionToken(token) ||
    !Number.isSafeInteger(now.getTime())
  ) {
    return null;
  }

  const session = withSessionDatabase((database) => {
    return findSession(
      database,
      hashSessionToken(token),
      now.getTime(),
    );
  });

  if (!session?.encryptedJellyfinToken) {
    return null;
  }

  return decryptJellyfinAccessToken(
    session.encryptedJellyfinToken,
    session.jellyfinUserId,
  );
}

export function revokeAuthenticatedSession(
  token: unknown,
): void {
  if (!isValidSessionToken(token)) {
    return;
  }

  withSessionDatabase((database) => {
    deleteSession(database, hashSessionToken(token));
  });
}

export function purgeExpiredAuthenticatedSessions(
  now: Date = new Date(),
): number {
  if (!Number.isSafeInteger(now.getTime())) {
    throw new Error("Invalid session cleanup timestamp.");
  }

  return withSessionDatabase((database) => {
    return deleteExpiredSessions(database, now.getTime());
  });
}
