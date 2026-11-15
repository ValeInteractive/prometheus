import { NextRequest } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/i;
const REQUEST_TIMEOUT_MS = 15000;

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

function safeString(
  value: unknown,
  maximumLength = 120,
): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximumLength)
    : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function safeBoolean(value: unknown): boolean {
  return value === true;
}

function serverUrl(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error("Jellyfin URL unavailable.");
  }

  const url = new URL(configured);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid Jellyfin URL.");
  }

  return url.origin;
}

async function jellyfinRequest(
  url: URL,
  authorization: string,
): Promise<Response> {
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(
      REQUEST_TIMEOUT_MS,
    ),
    headers: {
      Accept: "application/json",
      Authorization: authorization,
    },
  });
}

function sanitiseStreams(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .filter(
      (stream) =>
        stream.Type === "Video" ||
        stream.Type === "Audio" ||
        stream.Type === "Subtitle",
    )
    .slice(0, 40)
    .map((stream) => ({
      index: safeNumber(stream.Index),
      type: stream.Type,
      codec: safeString(stream.Codec),
      language: safeString(stream.Language, 24),
      displayTitle: safeString(
        stream.DisplayTitle,
        180,
      ),
      isDefault: safeBoolean(stream.IsDefault),
      isForced: safeBoolean(stream.IsForced),
      isExternal: safeBoolean(stream.IsExternal),
      channels: safeNumber(stream.Channels),
      width: safeNumber(stream.Width),
      height: safeNumber(stream.Height),
    }));
}

function sanitiseSources(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .slice(0, 10)
    .map((source) => ({
      id: safeString(source.Id, 128),
      name: safeString(source.Name, 180),
      container: safeString(source.Container, 60),
      runtimeTicks: safeNumber(
        source.RunTimeTicks,
      ),
      bitrate: safeNumber(source.Bitrate),
      supportsDirectPlay: safeBoolean(
        source.SupportsDirectPlay,
      ),
      supportsDirectStream: safeBoolean(
        source.SupportsDirectStream,
      ),
      supportsTranscoding: safeBoolean(
        source.SupportsTranscoding,
      ),
      streams: sanitiseStreams(
        source.MediaStreams,
      ),
    }));
}

export async function GET(
  request: NextRequest,
): Promise<Response> {
  const parameters = request.nextUrl.searchParams;
  const ids = parameters.getAll("id");

  if (
    ids.length !== 1 ||
    !ITEM_ID_PATTERN.test(ids[0]) ||
    [...parameters.keys()].some(
      (key) => key !== "id",
    )
  ) {
    return respond(
      { error: "Invalid media identifier." },
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

    const session = getAuthenticatedSession(
      cookie,
    );

    if (!session) {
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

    if (
      !ITEM_ID_PATTERN.test(session.jellyfinUserId)
    ) {
      return respond(
        { error: "Authentication unavailable." },
        503,
      );
    }

    const base = serverUrl();
    const id = ids[0];
    const userId = session.jellyfinUserId;

    const authorization =
      `MediaBrowser Token="${token}"`;

    // Verify the item is available to this user.
    const itemUrl = new URL(
      `/Users/${userId}/Items/${id}`,
      base,
    );

    const itemResponse = await jellyfinRequest(
      itemUrl,
      authorization,
    );

    if (
      itemResponse.status === 403 ||
      itemResponse.status === 404
    ) {
      return respond(
        { error: "Media unavailable." },
        404,
      );
    }

    if (!itemResponse.ok) {
      return respond(
        { error: "Jellyfin temporarily unavailable." },
        502,
      );
    }

    const item: unknown = await itemResponse.json();

    if (
      !isRecord(item) ||
      typeof item.Id !== "string" ||
      item.Id.toLowerCase() !== id.toLowerCase() ||
      !["Movie", "Episode"].includes(
        String(item.Type),
      )
    ) {
      return respond(
        { error: "Media unavailable." },
        404,
      );
    }

    // Read-only playback information.
    // A device-specific profile will be added
    // during actual playback negotiation.
    const playbackUrl = new URL(
      `/Items/${id}/PlaybackInfo`,
      base,
    );

    playbackUrl.searchParams.set(
      "userId",
      userId,
    );

    const playbackResponse = await jellyfinRequest(
      playbackUrl,
      authorization,
    );

    if (!playbackResponse.ok) {
      return respond(
        { error: "Playback information unavailable." },
        502,
      );
    }

    const playback: unknown =
      await playbackResponse.json();

    if (
      !isRecord(playback) ||
      !Array.isArray(playback.MediaSources)
    ) {
      return respond(
        { error: "Invalid playback response." },
        502,
      );
    }

    return respond(
      {
        item: {
          id,
          type: item.Type,
          title: safeString(item.Name, 300),
          overview: safeString(
            item.Overview,
            3000,
          ),
          runtimeTicks: safeNumber(
            item.RunTimeTicks,
          ),
          resumePositionTicks:
            isRecord(item.UserData)
              ? safeNumber(
                  item.UserData.PlaybackPositionTicks,
                )
              : null,
        },
        mediaSources: sanitiseSources(
          playback.MediaSources,
        ),
        playbackError: safeString(
          playback.ErrorCode,
          60,
        ),
        deviceProfileNegotiated: false,
      },
      200,
    );
  } catch {
    return respond(
      { error: "Playback service temporarily unavailable." },
      503,
    );
  }
}
