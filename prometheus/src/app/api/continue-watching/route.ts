import "server-only";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

const ID_PATTERN = /^[a-f0-9]{32}$/i;

const REQUEST_TIMEOUT_MS = 15000;
const MAX_ITEMS = 20;
const TICKS_PER_SECOND = 10_000_000;

interface ContinueWatchingItem {
  id: string;
  type: "Movie" | "Episode";
  title: string;
  seriesTitle: string | null;
  seriesId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  runtimeTicks: number;
  positionTicks: number;
  progressPercent: number;
  hasPoster: boolean;
}

function respond(
  body: unknown,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control":
        "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function safeText(
  value: unknown,
  maximum = 300,
): string | null {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  )
    ? value.slice(0, maximum)
    : null;
}

function safeNumber(
  value: unknown,
): number | null {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  )
    ? value
    : null;
}

function safeIndex(
  value: unknown,
): number | null {
  const number = safeNumber(value);

  return (
    number !== null &&
    Number.isInteger(number)
  )
    ? number
    : null;
}

function jellyfinOrigin(): string {
  const configured =
    process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error(
      "Jellyfin URL unavailable.",
    );
  }

  const url = new URL(configured);

  if (
    !["http:", "https:"].includes(
      url.protocol,
    ) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Invalid Jellyfin URL.",
    );
  }

  return url.origin;
}

function sanitiseItem(
  value: unknown,
): ContinueWatchingItem | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.Id !== "string" ||
    !ID_PATTERN.test(value.Id) ||
    (
      value.Type !== "Movie" &&
      value.Type !== "Episode"
    )
  ) {
    return null;
  }

  const title = safeText(value.Name);

  const runtimeTicks =
    safeNumber(value.RunTimeTicks);

  const userData = isRecord(value.UserData)
    ? value.UserData
    : null;

  const positionTicks = userData
    ? safeNumber(
        userData.PlaybackPositionTicks,
      )
    : null;

  if (
    !title ||
    runtimeTicks === null ||
    runtimeTicks <= 0 ||
    positionTicks === null ||
    userData?.Played === true
  ) {
    return null;
  }

  const seconds =
    positionTicks / TICKS_PER_SECOND;

  const percentage =
    (positionTicks / runtimeTicks) * 100;

  // Ignore content barely started or
  // effectively completed.
  if (
    seconds < 30 ||
    percentage >= 95 ||
    positionTicks >= runtimeTicks
  ) {
    return null;
  }

  const imageTags = isRecord(
    value.ImageTags,
  )
    ? value.ImageTags
    : {};

  const seriesId =
    typeof value.SeriesId === "string" &&
    ID_PATTERN.test(value.SeriesId)
      ? value.SeriesId
      : null;

  return {
    id: value.Id,
    type: value.Type,
    title,
    seriesTitle:
      safeText(value.SeriesName),
    seriesId,
    seasonNumber:
      safeIndex(value.ParentIndexNumber),
    episodeNumber:
      safeIndex(value.IndexNumber),
    runtimeTicks,
    positionTicks,
    progressPercent: Math.max(
      0,
      Math.min(
        100,
        Math.round(percentage),
      ),
    ),
    hasPoster:
      typeof imageTags.Primary === "string" &&
      imageTags.Primary.length > 0,
  };
}

export async function GET(): Promise<Response> {
  try {
    const cookie =
      await readSessionCookie();

    if (!cookie) {
      return respond(
        {
          error:
            "Authentication required.",
        },
        401,
      );
    }

    const session =
      getAuthenticatedSession(cookie);

    if (
      !session ||
      !ID_PATTERN.test(
        session.jellyfinUserId,
      )
    ) {
      return respond(
        {
          error:
            "Authentication required.",
        },
        401,
      );
    }

    const token =
      getAuthenticatedJellyfinAccessToken(
        cookie,
      );

    if (!token) {
      return respond(
        {
          error:
            "Authentication required.",
        },
        401,
      );
    }

    const origin = jellyfinOrigin();

    const url = new URL(
      `/Users/${session.jellyfinUserId}/Items/Resume`,
      origin,
    );

    url.searchParams.set(
      "Limit",
      String(MAX_ITEMS),
    );

    url.searchParams.set(
      "MediaTypes",
      "Video",
    );

    url.searchParams.set(
      "IncludeItemTypes",
      "Movie,Episode",
    );

    url.searchParams.set(
      "EnableUserData",
      "true",
    );

    url.searchParams.set(
      "EnableTotalRecordCount",
      "false",
    );

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(
        REQUEST_TIMEOUT_MS,
      ),
      headers: {
        Accept: "application/json",
        Authorization:
          `MediaBrowser Token="${token}"`,
      },
    });

    if (!response.ok) {
      return respond(
        {
          error:
            "Continue Watching unavailable.",
        },
        502,
      );
    }

    const payload: unknown =
      await response.json();

    if (
      !isRecord(payload) ||
      !Array.isArray(payload.Items)
    ) {
      return respond(
        {
          error:
            "Invalid Jellyfin response.",
        },
        502,
      );
    }

    const items = payload.Items
      .slice(0, 100)
      .map(sanitiseItem)
      .filter(
        (
          item,
        ): item is ContinueWatchingItem =>
          item !== null,
      )
      .slice(0, MAX_ITEMS);

    return respond(
      {
        items,
      },
      200,
    );
  } catch {
    return respond(
      {
        error:
          "Continue Watching temporarily unavailable.",
      },
      503,
    );
  }
}
