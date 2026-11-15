import "server-only";

import { NextRequest } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

const ID = /^[a-f0-9]{32}$/i;
const TIMEOUT = 15000;
const MAX_SEASONS = 150;
const MAX_EPISODES = 150;

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function respond(
  body: unknown,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: HEADERS,
  });
}

function record(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function text(
  value: unknown,
  max = 300,
): string | null {
  return typeof value === "string" &&
    value.trim().length > 0
    ? value.slice(0, max)
    : null;
}

function number(
  value: unknown,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function indexNumber(
  value: unknown,
): number | null {
  const result = number(value);

  return result !== null &&
    Number.isInteger(result)
    ? result
    : null;
}

function hasPoster(
  value: Record<string, unknown>,
): boolean {
  const tags = record(value.ImageTags)
    ? value.ImageTags
    : {};

  return typeof tags.Primary === "string" &&
    tags.Primary.length > 0;
}

function origin(): string {
  const configured =
    process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error("Jellyfin unavailable");
  }

  const url = new URL(configured);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid Jellyfin URL");
  }

  return url.origin;
}

async function jellyfin(
  url: URL,
  token: string,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      Accept: "application/json",
      Authorization:
        `MediaBrowser Token="${token}"`,
    },
  });

  if (
    response.status === 403 ||
    response.status === 404
  ) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Jellyfin request failed");
  }

  return response.json();
}

function resultItems(
  value: unknown,
): unknown[] {
  if (
    !record(value) ||
    !Array.isArray(value.Items)
  ) {
    throw new Error("Invalid Jellyfin response");
  }

  return value.Items;
}

function seasonItem(value: unknown) {
  if (
    !record(value) ||
    value.Type !== "Season" ||
    typeof value.Id !== "string" ||
    !ID.test(value.Id)
  ) {
    return null;
  }

  return {
    id: value.Id,
    title: text(value.Name) ?? "Season",
    number: indexNumber(value.IndexNumber),
    hasPoster: hasPoster(value),
  };
}

function episodeItem(
  value: unknown,
  seriesId: string,
  seasonId: string,
) {
  if (
    !record(value) ||
    value.Type !== "Episode" ||
    typeof value.Id !== "string" ||
    !ID.test(value.Id) ||
    typeof value.SeriesId !== "string" ||
    value.SeriesId.toLowerCase() !==
      seriesId.toLowerCase() ||
    typeof value.SeasonId !== "string" ||
    value.SeasonId.toLowerCase() !==
      seasonId.toLowerCase()
  ) {
    return null;
  }

  const userData = record(value.UserData)
    ? value.UserData
    : {};

  return {
    id: value.Id,
    title: text(value.Name) ?? "Episode",
    overview: text(value.Overview, 3000),
    episodeNumber: indexNumber(value.IndexNumber),
    seasonNumber:
      indexNumber(value.ParentIndexNumber),
    runtimeTicks: number(value.RunTimeTicks),
    playbackPositionTicks:
      number(userData.PlaybackPositionTicks),
    played: userData.Played === true,
    hasPoster: hasPoster(value),
  };
}

export async function GET(
  request: NextRequest,
): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const seriesIds = params.getAll("id");
  const seasonIds = params.getAll("seasonId");

  if (
    [...params.keys()].some(
      (key) => key !== "id" &&
        key !== "seasonId",
    ) ||
    seriesIds.length !== 1 ||
    !ID.test(seriesIds[0]) ||
    seasonIds.length > 1 ||
    (
      seasonIds.length === 1 &&
      !ID.test(seasonIds[0])
    )
  ) {
    return respond(
      { error: "Invalid series request." },
      400,
    );
  }

  try {
    const cookie = await readSessionCookie();

    if (!cookie) {
      return respond(
        { error: "Authentication required." },
        401,
      );
    }

    const session =
      getAuthenticatedSession(cookie);

    if (
      !session ||
      !ID.test(session.jellyfinUserId)
    ) {
      return respond(
        { error: "Authentication required." },
        401,
      );
    }

    const token =
      getAuthenticatedJellyfinAccessToken(
        cookie,
      );

    if (!token) {
      return respond(
        { error: "Authentication required." },
        401,
      );
    }

    const base = origin();
    const seriesId = seriesIds[0];
    const userId = session.jellyfinUserId;

    const seriesUrl = new URL(
      `/Users/${userId}/Items/${seriesId}`,
      base,
    );

    const series = await jellyfin(
      seriesUrl,
      token,
    );

    if (
      !record(series) ||
      series.Type !== "Series" ||
      typeof series.Id !== "string" ||
      series.Id.toLowerCase() !==
        seriesId.toLowerCase()
    ) {
      return respond(
        { error: "Series unavailable." },
        404,
      );
    }

    const seasonsUrl = new URL(
      `/Shows/${seriesId}/Seasons`,
      base,
    );

    seasonsUrl.searchParams.set(
      "UserId",
      userId,
    );

    seasonsUrl.searchParams.set(
      "EnableImages",
      "true",
    );

    const seasonsData = await jellyfin(
      seasonsUrl,
      token,
    );

    if (seasonsData === null) {
      return respond(
        { error: "Seasons unavailable." },
        404,
      );
    }

    const seasons = resultItems(seasonsData)
      .slice(0, MAX_SEASONS)
      .map(seasonItem)
      .filter(
        (value): value is NonNullable<
          ReturnType<typeof seasonItem>
        > => value !== null,
      );

    const selectedSeasonId =
      seasonIds[0] ?? null;

    let episodes: NonNullable<
      ReturnType<typeof episodeItem>
    >[] = [];

    if (selectedSeasonId) {
      const validSeason = seasons.some(
        (season) =>
          season.id.toLowerCase() ===
            selectedSeasonId.toLowerCase(),
      );

      if (!validSeason) {
        return respond(
          { error: "Season unavailable." },
          404,
        );
      }

      const episodesUrl = new URL(
        `/Shows/${seriesId}/Episodes`,
        base,
      );

      episodesUrl.searchParams.set(
        "UserId",
        userId,
      );

      episodesUrl.searchParams.set(
        "SeasonId",
        selectedSeasonId,
      );

      episodesUrl.searchParams.set(
        "IsMissing",
        "false",
      );

      episodesUrl.searchParams.set(
        "EnableUserData",
        "true",
      );

      episodesUrl.searchParams.set(
        "Fields",
        "Overview",
      );

      episodesUrl.searchParams.set(
        "Limit",
        String(MAX_EPISODES),
      );

      const episodesData = await jellyfin(
        episodesUrl,
        token,
      );

      if (episodesData === null) {
        return respond(
          { error: "Episodes unavailable." },
          404,
        );
      }

      episodes = resultItems(episodesData)
        .slice(0, MAX_EPISODES)
        .map((item) =>
          episodeItem(
            item,
            seriesId,
            selectedSeasonId,
          ),
        )
        .filter(
          (value): value is NonNullable<
            ReturnType<typeof episodeItem>
          > => value !== null,
        )
        .sort((a, b) =>
          (a.episodeNumber ?? 9999) -
          (b.episodeNumber ?? 9999),
        );
    }

    seasons.sort((a, b) =>
      (a.number ?? 9999) -
      (b.number ?? 9999),
    );

    return respond(
      {
        series: {
          id: series.Id,
          title: text(series.Name) ??
            "TV Series",
          overview:
            text(series.Overview, 3000),
          productionYear:
            indexNumber(series.ProductionYear),
          hasPoster: hasPoster(series),
          hasBackdrop: Array.isArray(series.BackdropImageTags) && series.BackdropImageTags.length > 0,
        },
        seasons,
        selectedSeasonId,
        episodes,
      },
      200,
    );
  } catch {
    return respond(
      {
        error:
          "TV series catalogue temporarily unavailable.",
      },
      503,
    );
  }
}
