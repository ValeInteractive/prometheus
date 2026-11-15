import "server-only";

import { cookies } from "next/headers";

import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  isValidSessionToken,
} from "./session-security";

import type { CreatedSession } from "./session-service";

const COOKIE_PATH = "/";

function secureCookiesEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function readSessionCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return isValidSessionToken(token) ? token : null;
}

export async function writeSessionCookie(
  session: CreatedSession,
): Promise<void> {
  if (
    !isValidSessionToken(session.token) ||
    !(session.expiresAt instanceof Date) ||
    !Number.isSafeInteger(session.expiresAt.getTime()) ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw new Error("Invalid session cookie input.");
  }

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: secureCookiesEnabled(),
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: session.expiresAt,
    maxAge: Math.max(
      0,
      Math.min(
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        SESSION_DURATION_MS / 1000,
      ),
    ),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: secureCookiesEnabled(),
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: 0,
    expires: new Date(0),
  });
}
