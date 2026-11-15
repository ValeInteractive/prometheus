import { NextResponse } from "next/server";

import {
  validateLoginOrigin,
} from "@/lib/auth/login-request";

import {
  readSessionCookie,
  clearSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  revokeAuthenticatedSession,
} from "@/lib/auth/session-service";


export async function POST(request: Request) {
  try {
    validateLoginOrigin(request);
  } catch {
    return NextResponse.json(
      { error: "Forbidden." },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const token = await readSessionCookie();

    if (token) {
      revokeAuthenticatedSession(token);
    }

    await clearSessionCookie();

    return NextResponse.json(
      { authenticated: false },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to complete logout." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
