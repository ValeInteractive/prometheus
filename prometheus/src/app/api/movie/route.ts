import "server-only";

import { NextRequest } from "next/server";

import { readSessionCookie } from "@/lib/auth/session-cookies";
import {
  getAuthenticatedJellyfinAccessToken,
  getAuthenticatedSession,
} from "@/lib/auth/session-service";

const ID = /^[a-f0-9]{32}$/i;
const TIMEOUT_MS = 15000;

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function respond(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 3000): string | null {
  return typeof value === "string" && value.trim()
    ? value.slice(0, max)
    : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function serverOrigin(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;
  if (!configured) throw new Error("Jellyfin is unavailable.");

  const url = new URL(configured);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid Jellyfin configuration.");
  }

  return url.origin;
}

async function getJson(url: URL, token: string): Promise<unknown | null> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Authorization: `MediaBrowser Token="${token}"`,
    },
  });

  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error("Jellyfin request failed.");
  return response.json();
}

function hasPrimaryImage(value: Record<string, unknown>): boolean {
  const tags = record(value.ImageTags) ? value.ImageTags : {};
  return typeof tags.Primary === "string" && tags.Primary.length > 0;
}

function hasBackdrop(value: Record<string, unknown>): boolean {
  return Array.isArray(value.BackdropImageTags) &&
    value.BackdropImageTags.some((tag) => typeof tag === "string" && tag.length > 0);
}

function movieItem(value: unknown) {
  if (
    !record(value) ||
    value.Type !== "Movie" ||
    typeof value.Id !== "string" ||
    !ID.test(value.Id) ||
    typeof value.Name !== "string"
  ) {
    return null;
  }

  const genres = Array.isArray(value.Genres)
    ? value.Genres
        .filter((genre): genre is string => typeof genre === "string")
        .slice(0, 12)
        .map((genre) => genre.slice(0, 80))
    : [];

  return {
    id: value.Id,
    title: value.Name.slice(0, 300),
    overview: text(value.Overview),
    productionYear: number(value.ProductionYear),
    communityRating: number(value.CommunityRating),
    runtimeTicks: number(value.RunTimeTicks),
    premiereDate: text(value.PremiereDate, 64),
    playbackPositionTicks: record(value.UserData) && value.UserData.Played !== true
      ? number(value.UserData.PlaybackPositionTicks)
      : null,
    genres,
    hasPoster: hasPrimaryImage(value),
    hasBackdrop: hasBackdrop(value),
  };
}

function localTrailer(value: unknown) {
  if (
    !record(value) ||
    typeof value.Id !== "string" ||
    !ID.test(value.Id) ||
    value.Type !== "Trailer"
  ) {
    return null;
  }

  return {
    id: value.Id,
    title: text(value.Name, 300) ?? "Trailer",
  };
}

function remoteTrailer(value: unknown) {
  const rawUrl = typeof value === "string"
    ? value
    : record(value) ? value.Url : null;
  const title = record(value) ? text(value.Name, 300) : null;

  if (typeof rawUrl !== "string") return null;

  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return null;

    return {
      url: url.toString(),
      title: title ?? "Online trailer",
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const ids = params.getAll("id");
  const modes = params.getAll("mode");

  if (
    (modes[0] === "collections" ? ids.length !== 0 : ids.length !== 1 || !ID.test(ids[0])) ||
    modes.length > 1 ||
    (modes.length === 1 && !["trailers", "collection", "collections"].includes(modes[0])) ||
    [...params.keys()].some((key) => key !== "id" && key !== "mode")
  ) {
    return respond({ error: "Invalid movie request." }, 400);
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
    const userId = session.jellyfinUserId;
    if (modes[0] === "collections") {
      const url = new URL(`/Users/${userId}/Items`, base);
      url.search = new URLSearchParams({
        IncludeItemTypes: "BoxSet", Recursive: "true", SortBy: "SortName",
      }).toString();

      const payload = await getJson(url, token);
      if (!record(payload) || !Array.isArray(payload.Items)) {
        return respond({ error: "Collections unavailable." }, 503);
      }

      const sets = payload.Items.filter(record).flatMap((item) => {
        const title = text(item.Name, 300);
        return item.Type === "BoxSet" && typeof item.Id === "string" && ID.test(item.Id) && title
          ? [{ id: item.Id, title, hasPoster: hasPrimaryImage(item) }]
          : [];
      });

      async function loadMembers(
        collection: (typeof sets)[number],
        accessToken: string,
      ) {
        const membersUrl = new URL(`/Users/${userId}/Items`, base);
        membersUrl.search = new URLSearchParams({
          ParentId: collection.id, IncludeItemTypes: "Movie", Recursive: "false",
        }).toString();
        const members = await getJson(membersUrl, accessToken);
        if (!record(members) || !Array.isArray(members.Items)) return null;

        const movieIds = [...new Set(members.Items.filter(record).flatMap((item) =>
          item.Type === "Movie" && typeof item.Id === "string" && ID.test(item.Id)
            ? [item.Id.toLowerCase()]
            : [],
        ))];

        return movieIds.length >= 2 ? { ...collection, movieIds } : null;
      }

      const collections: NonNullable<Awaited<ReturnType<typeof loadMembers>>>[] = [];
      for (let start = 0; start < sets.length; start += 6) {
        const batch = await Promise.all(
          sets.slice(start, start + 6).map((collection) => loadMembers(collection, token)),
        );
        for (const collection of batch) {
          if (collection) collections.push(collection);
        }
      }
      return respond({ collections }, 200);
    }

    const movieId = ids[0];

    const itemUrl = new URL(
      `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(movieId)}`,
      base,
    );
    itemUrl.searchParams.set(
      "Fields",
      "Overview,Genres,RemoteTrailers,DateCreated",
    );

    const rawMovie = await getJson(itemUrl, token);
    if (modes[0] === "collection") {
      if (!record(rawMovie) || rawMovie.Type !== "BoxSet" ||
          typeof rawMovie.Id !== "string" || rawMovie.Id.toLowerCase() !== movieId.toLowerCase()) {
        return respond({ error: "Collection unavailable." }, 404);
      }
      const membersUrl = new URL(`/Users/${userId}/Items`, base);
      membersUrl.search = new URLSearchParams({
        ParentId: movieId, IncludeItemTypes: "Movie", Recursive: "false",
      }).toString();
      const members = await getJson(membersUrl, token);
      if (!record(members) || !Array.isArray(members.Items)) {
        return respond({ error: "Collection unavailable." }, 503);
      }
      const movies = members.Items.filter(record).filter((item) => item.Type === "Movie")
        .map(movieItem).filter((item) => item !== null);
      function releaseDate(item: (typeof movies)[number]) {
        if (item.premiereDate && /^\d{4}-\d{2}-\d{2}/.test(item.premiereDate)) {
          return item.premiereDate.slice(0, 10);
        }
        return item.productionYear ? `${item.productionYear}-01-01` : "9999-99-99";
      }
      movies.sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)) || a.title.localeCompare(b.title));
      return respond({ title: text(rawMovie.Name) ?? "Collection", movies }, 200);
    }

    if (
      !record(rawMovie) ||
      rawMovie.Type !== "Movie" ||
      typeof rawMovie.Id !== "string" ||
      rawMovie.Id.toLowerCase() !== movieId.toLowerCase()
    ) {
      return respond({ error: "Movie unavailable." }, 404);
    }

    const localUrl = new URL(
      `/Items/${encodeURIComponent(movieId)}/LocalTrailers`,
      base,
    );
    localUrl.searchParams.set("UserId", userId);

    const rawLocal = await getJson(localUrl, token);
    const localTrailers = Array.isArray(rawLocal)
      ? rawLocal.map(localTrailer).filter((item) => item !== null).slice(0, 5)
      : [];

    const rawRemote = Array.isArray(rawMovie.RemoteTrailers)
      ? rawMovie.RemoteTrailers
      : [];
    const remoteTrailers = rawRemote
      .map(remoteTrailer)
      .filter((item) => item !== null)
      .slice(0, 5);

    if (modes[0] === "trailers") {
      return respond({ localTrailers, remoteTrailers }, 200);
    }

    const similarUrl = new URL(
      `/Items/${encodeURIComponent(movieId)}/Similar`,
      base,
    );
    similarUrl.searchParams.set("UserId", userId);
    similarUrl.searchParams.set("Limit", "12");
    similarUrl.searchParams.set("Fields", "Overview,Genres,DateCreated");

    const collectionsUrl = new URL(`/Items/${movieId}/Collections`, base);
    collectionsUrl.searchParams.set("UserId", userId);
    const [rawSimilar, rawCollections] = await Promise.all([
      getJson(similarUrl, token),
      getJson(collectionsUrl, token).catch(() => null),
    ]);
    const collections = record(rawCollections) && Array.isArray(rawCollections.Items)
      ? rawCollections.Items.filter(record).flatMap((item) =>
          item.Type === "BoxSet" && typeof item.Id === "string" && ID.test(item.Id) &&
          typeof item.Name === "string" && item.Name.trim()
            ? [{ id: item.Id, title: item.Name.slice(0, 300) }]
            : [],
        )
      : [];
    const similar = record(rawSimilar) && Array.isArray(rawSimilar.Items)
      ? rawSimilar.Items
          .map(movieItem)
          .filter((item): item is NonNullable<ReturnType<typeof movieItem>> => item !== null)
          .filter((item) => item.id.toLowerCase() !== movieId.toLowerCase())
          .slice(0, 12)
      : [];

    return respond({
      movie: movieItem(rawMovie),
      localTrailers,
      remoteTrailers,
      similar,
      collections,
    }, 200);
  } catch {
    return respond({ error: "Movie information temporarily unavailable." }, 503);
  }
}
