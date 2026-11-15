import "server-only";

import { NextRequest } from "next/server";

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

import {
  createDeviceProfile,
} from "@/lib/jellyfin/device-profile";

import {
  createNegotiatedHlsUrl,
} from "@/lib/jellyfin/hls-transcoding";

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
  limit = 120,
): string | null {
  return typeof value === "string" &&
    value.length > 0
    ? value.slice(0, limit)
    : null;
}

function safeNumber(
  value: unknown,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function getJellyfinUrl(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error("Jellyfin URL missing.");
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

async function requestJellyfin(
  url: URL,
  authorization: string,
  body?: unknown,
): Promise<Response> {
  return fetch(url, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(
      REQUEST_TIMEOUT_MS,
    ),
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });
}

async function getPlaybackSegments(base: string, id: string, authorization: string) {
  try {
    const response = await fetch(new URL(`/MediaSegments/${id}`, base), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
      headers: { Authorization: authorization, Accept: "application/json" },
    });
    if (!response.ok) return [];
    const result: unknown = await response.json();
    if (!isRecord(result) || !Array.isArray(result.Items)) return [];
    return result.Items.filter(isRecord).flatMap((segment) => {
      const start = safeNumber(segment.StartTicks);
      const end = safeNumber(segment.EndTicks);
      return (segment.Type === "Intro" || segment.Type === "Outro") && start !== null && end !== null && start >= 0 && end > start
        ? [{ type: segment.Type, start: start / 10_000_000, end: end / 10_000_000 }]
        : [];
    });
  } catch {
    return [];
  }
}

async function getNextEpisode(base: string, userId: string, seriesId: string, id: string, authorization: string) {
  const url = new URL(`/Shows/${seriesId}/Episodes`, base);
  url.search = new URLSearchParams({
    UserId: userId, StartItemId: id, Limit: "2", IsMissing: "false",
    EnableImages: "false", EnableUserData: "false",
  }).toString();

  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
      headers: { Authorization: authorization, Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.Items)) return null;
    const [current, next] = data.Items;
    if (!isRecord(current) || safeString(current.Id)?.toLowerCase() !== id.toLowerCase() ||
        !isRecord(next) || next.Type !== "Episode" ||
        safeString(next.SeriesId)?.toLowerCase() !== seriesId.toLowerCase()) return null;
    const nextId = safeString(next.Id);
    if (!nextId || !ITEM_ID_PATTERN.test(nextId) || nextId.toLowerCase() === id.toLowerCase()) return null;
    return { id: nextId, title: safeString(next.Name, 300) ?? "Next Episode" };
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const ids = params.getAll("id");
  const sourceId = params.get("source");
  const audio = params.get("audio");
  const subtitle = params.get("subtitle");
  const switching = audio !== null || subtitle !== null;
  const allowed = new Set(["id", "source", "audio", "subtitle"]);

  if (
    ids.length !== 1 ||
    !ITEM_ID_PATTERN.test(ids[0]) ||
    [...params.keys()].some(
      (key) => !allowed.has(key) || params.getAll(key).length !== 1,
    ) ||
    (switching !== (sourceId !== null)) ||
    (sourceId !== null && !ITEM_ID_PATTERN.test(sourceId)) ||
    (audio !== null && !/^\d{1,5}$/.test(audio)) ||
    (subtitle !== null && !/^(-1|\d{1,5})$/.test(subtitle)
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

    const id = ids[0];
    const userId = session.jellyfinUserId;
    const base = getJellyfinUrl();

    const authorization =
      `MediaBrowser Token="${token}"`;

    // Verify access before requesting playback details.
    const itemUrl = new URL(
      `/Users/${userId}/Items/${id}`,
      base,
    );

    const itemResponse = await requestJellyfin(
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
        { error: "Jellyfin unavailable." },
        502,
      );
    }

    const item: unknown =
      await itemResponse.json();

    if (
      !isRecord(item) ||
      typeof item.Id !== "string" ||
      item.Id.toLowerCase() !== id.toLowerCase() ||
      (
        item.Type !== "Movie" &&
        item.Type !== "Episode"
      )
    ) {
      return respond(
        { error: "Media unavailable." },
        404,
      );
    }

    const playbackUrl = new URL(
      `/Items/${id}/PlaybackInfo`,
      base,
    );

    const negotiationBody = {
      UserId: userId,
      DeviceProfile: createDeviceProfile("browser"),
      EnableDirectPlay: !switching,
      EnableDirectStream: !switching,
      ...(sourceId ? { MediaSourceId: sourceId } : {}),
      ...(audio !== null ? { AudioStreamIndex: Number(audio) } : {}),
      ...(subtitle !== null ? {
        SubtitleStreamIndex: Number(subtitle),
        AlwaysBurnInSubtitleWhenTranscoding: Number(subtitle) >= 0,
      } : {}),
      EnableTranscoding: true,
      AutoOpenLiveStream: false,
    };

    const playbackResponse = await requestJellyfin(
      playbackUrl,
      authorization,
      negotiationBody,
    );

    if (!playbackResponse.ok) {
      return respond(
        { error: "Playback negotiation failed." },
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

    const mediaSources = playback.MediaSources
      .filter(isRecord)
      .filter((source) => !sourceId || source.Id === sourceId)
      .slice(0, 10)
      .map((source) => ({
        id: safeString(source.Id, 128),
        audioIndex: safeNumber(source.DefaultAudioStreamIndex),
        subtitleIndex: safeNumber(source.DefaultSubtitleStreamIndex) ?? -1,
        tracks: Array.isArray(source.MediaStreams)
          ? source.MediaStreams.filter(isRecord).flatMap((stream) => {
              const { Type, Index } = stream;
              if ((Type !== "Audio" && Type !== "Subtitle") ||
                  typeof Index !== "number" || !Number.isSafeInteger(Index) || Index < 0) return [];
              return [{
                kind: Type,
                index: Index,
                language: safeString(stream.Language, 32),
                commentary: /commentary/i.test(
                  [stream.Title, stream.DisplayTitle].filter(Boolean).join(" "),
                ),
                label: safeString(stream.DisplayTitle) ?? safeString(stream.Title) ??
                  safeString(stream.Language) ?? `${Type} ${Index}`,
              }];
            })
          : [],
        directPlayable:
          isPrometheusDirectSource(source),
        hlsUrl: createNegotiatedHlsUrl(
          source.TranscodingUrl,
          id,
          userId,
          base,
        ),
        container: safeString(source.Container, 60),
        runtimeTicks: safeNumber(
          source.RunTimeTicks,
        ),
        bitrate: safeNumber(source.Bitrate),
        supportsDirectPlay:
          source.SupportsDirectPlay === true,
        supportsDirectStream:
          source.SupportsDirectStream === true,
        supportsTranscoding:
          source.SupportsTranscoding === true,
        requiresTranscoding:
          source.SupportsDirectPlay !== true &&
          source.SupportsDirectStream !== true &&
          source.SupportsTranscoding === true,
      }));

    const seriesId = item.Type === "Episode" && typeof item.SeriesId === "string" &&
      ITEM_ID_PATTERN.test(item.SeriesId) ? item.SeriesId : null;
    const [segments, nextEpisode] = await Promise.all([
      item.Type === "Episode" && !switching ? getPlaybackSegments(base, id, authorization) : [],
      seriesId && !switching ? getNextEpisode(base, userId, seriesId, id, authorization) : null,
    ]);

    // Never return Jellyfin's raw MediaSources.
    // They may contain paths and streaming URLs.
    return respond(
      {
        item: {
          id,
          type: item.Type,
          intros: segments.filter((segment) => segment.type === "Intro"),
          credits: segments.filter((segment) => segment.type === "Outro"),
          seriesId,
          nextEpisode,
          title: safeString(item.Name, 300),
          episodeLabel: item.Type === "Episode" ? [
            safeString(item.SeriesName, 300),
            typeof item.ParentIndexNumber === "number" && typeof item.IndexNumber === "number"
              ? `S${item.ParentIndexNumber} E${item.IndexNumber}` : null,
          ].filter(Boolean).join(" · ") : null,
          runtimeTicks: safeNumber(
            item.RunTimeTicks,
          ),
        },
        device: "browser",
        playSessionId: safeString(
          playback.PlaySessionId,
          128,
        ),
        deviceProfileNegotiated: true,
        mediaSources,
        playbackError: safeString(
          playback.ErrorCode,
          60,
        ),
      },
      200,
    );
  } catch {
    return respond(
      { error: "Playback service unavailable." },
      503,
    );
  }
}
