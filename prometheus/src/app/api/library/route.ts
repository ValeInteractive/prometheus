import { NextRequest, NextResponse } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

import {
  getPrometheusLibrary,
  browsePrometheusLibrary,
} from "@/lib/jellyfin/library";

function respond(
  body: unknown,
  status: number,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control":
        "private, no-store, max-age=0",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const token = await readSessionCookie();

    if (!token) {
      return respond(
        { error: "Authentication required." },
        401,
      );
    }

    const session = getAuthenticatedSession(token);

    if (!session) {
      return respond(
        { error: "Authentication required." },
        401,
      );
    }

    const accessToken =
      getAuthenticatedJellyfinAccessToken(token);

    if (!accessToken) {
      return respond(
        { error: "Authentication required." },
        401,
      );
    }

    const query = request.nextUrl.searchParams;
    if (query.size > 0) {
      const mode = query.get("mode");
      const type = query.get("type");
      const search = query.get("q")?.trim();
      const offset = query.get("offset") ?? "0";
      if (
        [...query.keys()].some((key) =>
          !["mode", "type", "q", "offset"].includes(key) || query.getAll(key).length !== 1
        ) ||
        (mode !== "search" && mode !== "favourites" && mode !== "catalogue" && mode !== "random-favourites") ||
        (type !== "Movie" && type !== "Series") ||
        (mode === "search" ? !search || search.length > 100 : query.has("q")) ||
        !/^\d{1,7}$/.test(offset)
      ) return respond({ error: "Invalid library request." }, 400);

      const items = await browsePrometheusLibrary(session.jellyfinUserId, accessToken, type, {
        search, favourites: mode === "favourites", offset: Number(offset),
        catalogue: mode === "catalogue",
        allFavourites: mode === "random-favourites",
      });
      return respond({ items }, 200);
    }

    const library = await getPrometheusLibrary(
      session.jellyfinUserId,
      accessToken,
    );

    return respond(library, 200);
  } catch {
    return respond(
      { error: "Media library temporarily unavailable." },
      503,
    );
  }
}
