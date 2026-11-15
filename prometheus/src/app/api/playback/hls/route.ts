import "server-only";

import { NextRequest } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

import {
  createSignedHlsUrl,
  validateHlsResource,
  verifySignedHlsRequest,
} from "@/lib/jellyfin/hls-access";

import {
  rewriteHlsPlaylist,
} from "@/lib/jellyfin/hls-playlist";

const ID_PATTERN = /^[a-f0-9]{32}$/i;

const MAX_PLAYLIST_BYTES = 1024 * 1024;

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

function getJellyfinOrigin(): string {
  const configured =
    process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error(
      "Jellyfin server URL unavailable.",
    );
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
    throw new Error(
      "Invalid Jellyfin server configuration.",
    );
  }

  return parsed.origin;
}

async function requestJson(
  url: URL,
  authorization: string,
): Promise<Response> {
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
  });
}

async function readLimitedPlaylist(
  response: Response,
): Promise<string> {
  if (!response.body) {
    throw new Error("Empty HLS playlist.");
  }

  const reader = response.body.getReader();

  const chunks: Uint8Array[] = [];

  let total = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      total += result.value.byteLength;

      if (total > MAX_PLAYLIST_BYTES) {
        throw new Error(
          "HLS playlist exceeds size limit.",
        );
      }

      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder(
    "utf-8",
    { fatal: true },
  ).decode(bytes);
}

export async function GET(
  request: NextRequest,
): Promise<Response> {
  const params = request.nextUrl.searchParams;

  const keys = [...params.keys()];

  const allowedKeys = new Set([
    "id",
    "resource",
    "expires",
    "signature",
  ]);

  if (
    keys.length !== 4 ||
    new Set(keys).size !== 4 ||
    !keys.every((key) => allowedKeys.has(key))
  ) {
    return respond(
      400,
      "Invalid HLS request.",
    );
  }

  const id = params.get("id") ?? "";

  const resource =
    params.get("resource") ?? "";

  const expires =
    params.get("expires") ?? "";

  const signature =
    params.get("signature") ?? "";

  const kind = validateHlsResource(
    resource,
    id,
  );

  if (
    !ID_PATTERN.test(id) ||
    !kind
  ) {
    return respond(
      400,
      "Invalid HLS resource.",
    );
  }

  // Range handling for HLS resources is not
  // implemented yet. Reject it explicitly.
  if (
    request.headers.has("range") ||
    request.headers.has("if-range")
  ) {
    return respond(
      400,
      "HLS byte ranges are not supported.",
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

    if (!session) {
      return respond(
        401,
        "Authentication required.",
      );
    }

    const token =
      getAuthenticatedJellyfinAccessToken(
        cookie,
      );

    if (
      !token ||
      !ID_PATTERN.test(session.jellyfinUserId)
    ) {
      return respond(
        401,
        "Authentication required.",
      );
    }

    const userId =
      session.jellyfinUserId;

    if (
      !verifySignedHlsRequest(
        id,
        userId,
        resource,
        expires,
        signature,
      )
    ) {
      return respond(
        403,
        "Invalid or expired HLS authorisation.",
      );
    }

    const origin = getJellyfinOrigin();

    const authorization =
      `MediaBrowser Token="${token}"`;

    // Verify this user can access the media.
    const itemUrl = new URL(
      `/Users/${userId}/Items/${id}`,
      origin,
    );

    const itemResponse = await requestJson(
      itemUrl,
      authorization,
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
      item.Id.toLowerCase() !== id.toLowerCase() ||
      !["Movie", "Episode"].includes(
        String(item.Type),
      )
    ) {
      return respond(
        404,
        "Media unavailable.",
      );
    }

    // The resource is already validated and signed.
    // Never accept an arbitrary URL supplied by
    // the browser.
    const upstreamUrl = new URL(
      resource,
      origin,
    );

    const upstream = await fetch(
      upstreamUrl,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: authorization,
          Accept:
            kind === "playlist"
              ? "application/vnd.apple.mpegurl"
              : "*/*",
        },
      },
    );

    if (
      upstream.status !== 200
    ) {
      await upstream.body?.cancel();

      return respond(
        upstream.status === 404 ? 404 : 502,
        "HLS resource unavailable.",
      );
    }

    if (kind === "playlist") {
      const playlist =
        await readLimitedPlaylist(upstream);

      const rewritten =
        rewriteHlsPlaylist(
          playlist,
          id,
          upstreamUrl,
          (nextResource) =>
            createSignedHlsUrl(
              id,
              userId,
              nextResource,
            ),
        );

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...PRIVATE_HEADERS,
          "Content-Type":
            "application/vnd.apple.mpegurl; charset=utf-8",
        },
      });
    }

    if (!upstream.body) {
      return respond(
        502,
        "Empty HLS segment.",
      );
    }

    const extension =
      upstreamUrl.pathname
        .split(".")
        .pop()
        ?.toLowerCase();

    const contentType =
      extension === "ts"
        ? "video/mp2t"
        : "video/mp4";

    const headers = new Headers(
      PRIVATE_HEADERS,
    );

    headers.set(
      "Content-Type",
      contentType,
    );

    const contentLength =
      upstream.headers.get(
        "content-length",
      );

    if (
      contentLength &&
      /^[0-9]+$/.test(contentLength)
    ) {
      headers.set(
        "Content-Length",
        contentLength,
      );
    }

    return new Response(
      upstream.body,
      {
        status: 200,
        headers,
      },
    );
  } catch {
    return respond(
      503,
      "HLS playback service unavailable.",
    );
  }
}
