import { NextResponse } from "next/server";

import {
  authenticateJellyfinUser,
} from "@/lib/jellyfin/auth";

import {
  LoginRequestError,
  parseLoginCredentials,
} from "@/lib/auth/login-request";

import {
  consumeAccountLoginAttempt,
  LoginRateLimitServiceError,
} from "@/lib/auth/login-rate-limit-service";

import {
  createAuthenticatedSession,
  revokeAuthenticatedSession,
} from "@/lib/auth/session-service";

import {
  writeSessionCookie,
} from "@/lib/auth/session-cookies";


function json(
  status: number,
  message: string,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...extraHeaders,
      },
    },
  );
}

export async function POST(request: Request) {
  let credentials;

  try {
    credentials = await parseLoginCredentials(request);
  } catch (error) {
    if (error instanceof LoginRequestError) {
      return json(error.status, "Invalid login request.");
    }

    return json(400, "Invalid login request.");
  }

  let decision;

  try {
    decision = consumeAccountLoginAttempt(
      credentials.username,
    );
  } catch (error) {
    if (error instanceof LoginRateLimitServiceError) {
      return json(503, "Authentication temporarily unavailable.");
    }

    return json(503, "Authentication temporarily unavailable.");
  }

  if (!decision.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil(decision.retryAfterMs / 1000),
    );

    return json(
      429,
      "Too many login attempts. Please try again later.",
      {
        "Retry-After": String(retryAfter),
      },
    );
  }

  let authenticated;

  try {
    authenticated = await authenticateJellyfinUser(
      credentials.username,
      credentials.password,
    );
  } catch {
    return json(401, "Invalid credentials or authentication unavailable.");
  }

  let session;

  try {
    session = createAuthenticatedSession(
      authenticated.user.id,
      authenticated.accessToken,
    );
  } catch {
    return json(503, "Unable to create session.");
  }

  try {
    await writeSessionCookie(session);
  } catch {
    try {
      revokeAuthenticatedSession(session.token);
    } catch {
      // Session cleanup failure must not expose secrets.
    }

    return json(503, "Unable to establish session.");
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: authenticated.user.id,
        name: authenticated.user.name,
      },
      expiresAt: session.expiresAt.toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
