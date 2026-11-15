import "server-only";

import { NextRequest } from "next/server";
import { createDeviceProfile } from "@/lib/jellyfin/device-profile";

import {
  isPrometheusDirectSource,
} from "@/lib/jellyfin/direct-play";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/i;

const REQUEST_TIMEOUT_MS = 15000;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function respond(
  status: number,
  error: string,
): Response {
  return Response.json(
    { error },
    {
      status,
      headers: PRIVATE_HEADERS,
    },
  );
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

function getServerUrl(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error("Jellyfin URL missing.");
  }

  const parsed = new URL(configured);

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error("Invalid Jellyfin configuration.");
  }

  return parsed.origin;
}

function validRange(
  range: string,
): boolean {
  // Initially support one conventional HTTP byte range.
  // Suffix and multipart requests are not supported yet.
  return /^bytes=\d+-(?:\d+)?$/.test(range);
}

async function jellyfinJson(
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
      Authorization: authorization,
      Accept: "application/json",
    },
  });
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
    return respond(400, "Invalid media identifier.");
  }

  const range = request.headers.get("range");

  if (range !== null && !validRange(range)) {
    return respond(416, "Unsupported byte range.");
  }

  if (request.headers.has("if-range")) {
    return respond(400, "Unsupported conditional range.");
  }

  try {
    const cookie = await readSessionCookie();

    if (!cookie) {
      return respond(401, "Authentication required.");
    }

    const session = getAuthenticatedSession(cookie);

    if (!session) {
      return respond(401, "Authentication required.");
    }

    const token =
      getAuthenticatedJellyfinAccessToken(cookie);

    if (!token) {
      return respond(401, "Authentication required.");
    }

    const userId = session.jellyfinUserId;

    if (!ITEM_ID_PATTERN.test(userId)) {
      return respond(503, "Authentication unavailable.");
    }

    const id = ids[0];

    const base = getServerUrl();

    const authorization =
      `MediaBrowser Token="${token}"`;

    // Check item permissions before requesting video.
    const itemUrl = new URL(
      `/Users/${userId}/Items/${id}`,
      base,
    );

    const itemResponse = await jellyfinJson(
      itemUrl,
      authorization,
    );

    if (
      itemResponse.status === 403 ||
      itemResponse.status === 404
    ) {
      return respond(404, "Media unavailable.");
    }

    if (!itemResponse.ok) {
      return respond(502, "Jellyfin unavailable.");
    }

    const item: unknown = await itemResponse.json();

    if (
      !isRecord(item) ||
      typeof item.Id !== "string" ||
      item.Id.toLowerCase() !== id.toLowerCase() ||
      (
        item.Type !== "Movie" &&
        item.Type !== "Episode" &&
        item.Type !== "Trailer"
      )
    ) {
      return respond(404, "Media unavailable.");
    }

    // Inspect available original files.
    const playbackUrl = new URL(
      `/Items/${id}/PlaybackInfo`,
      base,
    );

    const playbackResponse = await fetch(playbackUrl, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        UserId: userId,
        DeviceProfile: createDeviceProfile("browser"),
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AutoOpenLiveStream: false,
      }),
    });

    if (!playbackResponse.ok) {
      return respond(
        502,
        "Playback information unavailable.",
      );
    }

    const playback: unknown =
      await playbackResponse.json();

    if (
      !isRecord(playback) ||
      !Array.isArray(playback.MediaSources)
    ) {
      return respond(
        502,
        "Invalid playback information.",
      );
    }

    const source = playback.MediaSources.find(
      isPrometheusDirectSource,
    );

    if (!source) {
      return respond(
        415,
        "This video requires transcoding.",
      );
    }

    // Jellyfin credentials remain server-side.
    const videoUrl = new URL(
      `/Videos/${id}/stream`,
      base,
    );

    videoUrl.searchParams.set("Static", "true");

    videoUrl.searchParams.set(
      "MediaSourceId",
      String(source.Id),
    );

    const videoResponse = await fetch(videoUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(
        REQUEST_TIMEOUT_MS,
      ),
      headers: {
        Authorization: authorization,
        ...(range ? { Range: range } : {}),
      },
    });

    if (
      videoResponse.status !== 200 &&
      videoResponse.status !== 206
    ) {
      await videoResponse.body?.cancel();

      if (videoResponse.status === 416) {
        return respond(416, "Range unavailable.");
      }

      return respond(
        502,
        "Video stream unavailable.",
      );
    }

    // Do not silently return a complete file when
    // a byte-range response was explicitly requested.
    if (
      range !== null &&
      videoResponse.status !== 206
    ) {
      await videoResponse.body?.cancel();

      return respond(
        502,
        "Jellyfin did not honour the byte range.",
      );
    }

    if (!videoResponse.body) {
      return respond(502, "Empty video stream.");
    }

    const headers = new Headers(PRIVATE_HEADERS);

    headers.set("Content-Type", "video/mp4");

    const contentLength =
      videoResponse.headers.get("content-length");

    const contentRange =
      videoResponse.headers.get("content-range");

    const acceptRanges =
      videoResponse.headers.get("accept-ranges");

    if (
      videoResponse.status === 206 &&
      (
        !contentRange ||
        !/^bytes \d+-\d+\/\d+$/.test(contentRange)
      )
    ) {
      await videoResponse.body.cancel();

      return respond(
        502,
        "Invalid upstream byte-range response.",
      );
    }

    if (contentLength) {
      headers.set(
        "Content-Length",
        contentLength,
      );
    }

    if (contentRange) {
      headers.set(
        "Content-Range",
        contentRange,
      );
    }

    if (
      acceptRanges?.toLowerCase() === "bytes" ||
      videoResponse.status === 206
    ) {
      headers.set("Accept-Ranges", "bytes");
    }

    return new Response(videoResponse.body, {
      status: videoResponse.status,
      headers,
    });
  } catch {
    return respond(
      503,
      "Video streaming temporarily unavailable.",
    );
  }
}
