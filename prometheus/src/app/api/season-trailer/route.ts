import "server-only";

import { NextRequest } from "next/server";
import { readSessionCookie } from "@/lib/auth/session-cookies";
import {
  getAuthenticatedJellyfinAccessToken,
  getAuthenticatedSession,
} from "@/lib/auth/session-service";

const ID = /^[a-f0-9]{32}$/i;
const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function respond(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serverOrigin(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;
  if (!configured) throw new Error("Jellyfin URL is missing.");

  const url = new URL(configured);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid Jellyfin URL.");
  }
  return url.origin;
}

async function getJson(url: URL, token: string): Promise<unknown | null> {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      Authorization: `MediaBrowser Token="${token}"`,
    },
  });

  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error("Jellyfin request failed.");
  return response.json();
}

function localTrailer(value: unknown) {
  if (
    !isRecord(value) ||
    value.Type !== "Trailer" ||
    typeof value.Id !== "string" ||
    !ID.test(value.Id)
  ) return null;

  return {
    id: value.Id,
    title: typeof value.Name === "string" ? value.Name.slice(0, 300) : "Trailer",
  };
}

function remoteTrailer(value: unknown) {
  if (!isRecord(value) || typeof value.Url !== "string") return null;

  try {
    const url = new URL(value.Url);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    return {
      url: url.toString(),
      title: typeof value.Name === "string" ? value.Name.slice(0, 300) : "Trailer",
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const ids = params.getAll("id");
  const itemType = params.get("type") ?? "Season";

  if (
    ids.length !== 1 ||
    !ID.test(ids[0]) ||
    params.getAll("type").length > 1 ||
    (itemType !== "Season" && itemType !== "Series") ||
    [...params.keys()].some((key) => key !== "id" && key !== "type")
  ) {
    return respond({ error: "Invalid trailer request." }, 400);
  }

  try {
    const cookie = await readSessionCookie();
    if (!cookie) return respond({ error: "Authentication required." }, 401);

    const session = getAuthenticatedSession(cookie);
    const token = getAuthenticatedJellyfinAccessToken(cookie);
    if (!session || !ID.test(session.jellyfinUserId) || !token) {
      return respond({ error: "Authentication required." }, 401);
    }

    const base = serverOrigin();
    const seasonId = ids[0];
    const userId = session.jellyfinUserId;
    const itemUrl = new URL(`/Users/${userId}/Items/${seasonId}`, base);
    itemUrl.searchParams.set("Fields", "RemoteTrailers");

    const season = await getJson(itemUrl, token);
    if (
      !isRecord(season) ||
      season.Type !== itemType ||
      typeof season.Id !== "string" ||
      season.Id.toLowerCase() !== seasonId.toLowerCase()
    ) {
      return respond({ error: "Title unavailable." }, 404);
    }

    const localUrl = new URL(`/Items/${seasonId}/LocalTrailers`, base);
    localUrl.searchParams.set("UserId", userId);
    const rawLocal = await getJson(localUrl, token);

    const localTrailers = Array.isArray(rawLocal)
      ? rawLocal
          .map(localTrailer)
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .slice(0, 5)
      : [];

    const rawRemote = Array.isArray(season.RemoteTrailers)
      ? season.RemoteTrailers
      : [];
    const remoteTrailers = rawRemote
      .map(remoteTrailer)
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 5);

    return respond({ localTrailers, remoteTrailers }, 200);
  } catch {
    return respond({ error: "Trailers are temporarily unavailable." }, 503);
  }
}
