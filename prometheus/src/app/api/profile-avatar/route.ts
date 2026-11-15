import { NextResponse } from "next/server";
import { readSessionCookie } from "@/lib/auth/session-cookies";
import { getAuthenticatedSession } from "@/lib/auth/session-service";
import { getProfileAvatar } from "@/lib/profiles/avatar-preferences";

export async function GET() {
  try {
    const token = await readSessionCookie();
    const session = token ? getAuthenticatedSession(token) : null;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ avatarId: getProfileAvatar(session.jellyfinUserId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load profile picture." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
