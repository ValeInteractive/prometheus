import "server-only";

import { isTrustedPrometheusOrigin } from "@/lib/auth/trusted-origin";

import { NextRequest } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

const ID = /^[a-f0-9]{32}$/i;

const MAX_BODY_BYTES = 2048;
const MAX_POSITION_SECONDS = 7 * 24 * 60 * 60;

type PlaybackEvent = "start" | "progress" | "stop";
type PlaybackMode = "direct" | "hls";

interface ProgressInput {
  id: string;
  mediaSourceId?: string | null;
  playSessionId?: string | null;
  event: PlaybackEvent;
  positionSeconds: number;
  mode: PlaybackMode;
  paused?: boolean;
}

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function respond(
  status: number,
  message: string,
): Response {
  return Response.json(
    { error: message },
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

function configuredOrigin(
  name: string,
): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing configuration: ${name}`,
    );
  }

  const parsed = new URL(value);

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `Invalid configuration: ${name}`,
    );
  }

  if (
    name === "JELLYFIN_SERVER_URL" &&
    parsed.pathname !== "/"
  ) {
    throw new Error(
      "Unsupported Jellyfin base path.",
    );
  }

  return parsed.origin;
}

function parseInput(
  value: unknown,
): ProgressInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const allowed = new Set([
    "id",
    "mediaSourceId",
    "playSessionId",
    "event",
    "positionSeconds",
    "mode",
    "paused",
  ]);

  if (
    Object.keys(value).some(
      (key) => !allowed.has(key),
    ) ||
    typeof value.id !== "string" ||
    !ID.test(value.id) ||
    (
      value.mediaSourceId != null &&
      (
        typeof value.mediaSourceId !== "string" ||
        value.mediaSourceId.length < 1 ||
        value.mediaSourceId.length > 128 ||
        !/^[a-zA-Z0-9._:-]+$/.test(
          value.mediaSourceId
        )
      )
    ) ||
    (
      value.playSessionId != null &&
      (
        typeof value.playSessionId !== "string" ||
        value.playSessionId.length < 1 ||
        value.playSessionId.length > 128 ||
        !/^[a-zA-Z0-9_-]+$/.test(
          value.playSessionId
        )
      )
    ) ||
    (
      value.event !== "start" &&
      value.event !== "progress" &&
      value.event !== "stop"
    ) ||
    (
      value.mode !== "direct" &&
      value.mode !== "hls"
    ) ||
    typeof value.positionSeconds !== "number" ||
    !Number.isFinite(value.positionSeconds) ||
    value.positionSeconds < 0 ||
    value.positionSeconds > MAX_POSITION_SECONDS ||
    (
      value.paused !== undefined &&
      typeof value.paused !== "boolean"
    )
  ) {
    return null;
  }

  return {
    id: value.id,
    mediaSourceId: value.mediaSourceId ?? null,
    playSessionId: value.playSessionId ?? null,
    event: value.event,
    mode: value.mode,
    positionSeconds: value.positionSeconds,
    paused: value.paused,
  };
}

export async function POST(
  request: NextRequest,
): Promise<Response> {
  if (request.nextUrl.search) {
    return respond(
      400,
      "Unexpected query parameters.",
    );
  }

  if (
    request.headers.get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase() !== "application/json"
  ) {
    return respond(
      415,
      "JSON request required.",
    );
  }

  // Playback writes must originate from a trusted PROMETHEUS endpoint.
  if (!isTrustedPrometheusOrigin(request.headers.get("origin"))) {
    return respond(
      403,
      "Origin not authorised.",
    );
  }

  const declaredLength = Number(
    request.headers.get("content-length") ?? "0",
  );

  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_BODY_BYTES
  ) {
    return respond(
      413,
      "Request too large.",
    );
  }

  let input: ProgressInput | null;

  try {
    const body = await request.text();

    if (
      new TextEncoder().encode(body).byteLength >
      MAX_BODY_BYTES
    ) {
      return respond(
        413,
        "Request too large.",
      );
    }

    input = parseInput(JSON.parse(body));
  } catch {
    return respond(
      400,
      "Invalid request body.",
    );
  }

  if (!input) {
    return respond(
      400,
      "Invalid playback progress.",
    );
  }

  try {
    const cookie = await readSessionCookie();

    if (!cookie) {
      return respond(
        401,
        "Authentication required.",
      );
    }

    const session =
      getAuthenticatedSession(cookie);

    if (
      !session ||
      !ID.test(session.jellyfinUserId)
    ) {
      return respond(
        401,
        "Authentication required.",
      );
    }

    const token =
      getAuthenticatedJellyfinAccessToken(
        cookie,
      );

    if (!token) {
      return respond(
        401,
        "Authentication required.",
      );
    }

    const origin = configuredOrigin(
      "JELLYFIN_SERVER_URL",
    );

    const authorization =
      `MediaBrowser Token="${token}"`;

    const itemUrl = new URL(
      `/Users/${session.jellyfinUserId}/Items/${input.id}`,
      origin,
    );

    const itemResponse = await fetch(
      itemUrl,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      },
    );

    if (
      itemResponse.status === 403 ||
      itemResponse.status === 404
    ) {
      return respond(
        404,
        "Media unavailable.",
      );
    }

    if (!itemResponse.ok) {
      return respond(
        502,
        "Jellyfin unavailable.",
      );
    }

    const item: unknown =
      await itemResponse.json();

    if (
      !isRecord(item) ||
      typeof item.Id !== "string" ||
      item.Id.toLowerCase() !==
        input.id.toLowerCase() ||
      (
        item.Type !== "Movie" &&
        item.Type !== "Episode"
      )
    ) {
      return respond(
        404,
        "Media unavailable.",
      );
    }

    const duration =
      typeof item.RunTimeTicks === "number" &&
      Number.isFinite(item.RunTimeTicks) &&
      item.RunTimeTicks > 0
        ? item.RunTimeTicks
        : null;

    const requestedTicks = Math.round(
      input.positionSeconds * 10_000_000,
    );

    const positionTicks =
      duration === null
        ? requestedTicks
        : Math.min(
            requestedTicks,
            duration,
          );

    const endpoint =
      input.event === "start"
        ? "/Sessions/Playing"
        : input.event === "progress"
          ? "/Sessions/Playing/Progress"
          : "/Sessions/Playing/Stopped";

    const playMethod =
      input.mode === "hls"
        ? "Transcode"
        : "DirectPlay";

    const payload =
      input.event === "stop"
        ? {
            ItemId: input.id,
            MediaSourceId: input.mediaSourceId,
            PlaySessionId: input.playSessionId,
            PositionTicks: positionTicks,
          }
        : {
            ItemId: input.id,
            MediaSourceId: input.mediaSourceId,
            PlaySessionId: input.playSessionId,
            PositionTicks: positionTicks,
            PlayMethod: playMethod,
            CanSeek: true,
            IsPaused: input.paused === true,
          };

    const upstream = await fetch(
      new URL(endpoint, origin),
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    await upstream.body?.cancel();

    if (!upstream.ok) {
      return respond(
        502,
        "Playback progress could not be saved.",
      );
    }

    return Response.json(
      { saved: true },
      {
        status: 200,
        headers: PRIVATE_HEADERS,
      },
    );
  } catch {
    return respond(
      503,
      "Playback progress service unavailable.",
    );
  }
}
