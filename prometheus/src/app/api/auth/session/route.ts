import { NextResponse } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
} from "@/lib/auth/session-service";


export async function GET() {
  try {
    const token = await readSessionCookie();

    if (!token) {
      return NextResponse.json(
        { authenticated: false },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const session = getAuthenticatedSession(token);

    if (!session) {
      return NextResponse.json(
        { authenticated: false },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        authenticated: true,
        user: {
          id: session.jellyfinUserId,
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
  } catch {
    return NextResponse.json(
      { error: "Session verification unavailable." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
