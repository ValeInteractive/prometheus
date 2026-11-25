import { NextRequest } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
  getAuthenticatedJellyfinAccessToken,
} from "@/lib/auth/session-service";

const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/i;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 15000;

type ArtworkType = "Primary" | "Backdrop" | "Trickplay";

function errorResponse(
  status: number,
  message: string,
): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function getServerUrl(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error("Missing Jellyfin configuration.");
  }

  const parsed = new URL(configured);

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Invalid Jellyfin configuration.");
  }

  return parsed.origin;
}

function validArtworkType(
  value: string | null,
): value is ArtworkType {
  return value === "Primary" || value === "Backdrop" || value === "Trickplay";
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

async function verifyMediaAccess(
  serverUrl: string,
  userId: string,
  itemId: string,
  authorization: string,
): Promise<boolean> {
  if (!ITEM_ID_PATTERN.test(userId)) {
    return false;
  }

  const url = new URL(
    `/Users/${userId}/Items/${itemId}`,
    serverUrl,
  );

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return false;
  }

  const item: unknown = await response.json();

  return (
    isRecord(item) &&
    typeof item.Id === "string" &&
    item.Id.toLowerCase() === itemId.toLowerCase() &&
    (item.Type === "Movie" ||
      item.Type === "Series" ||
      item.Type === "Season" ||
      item.Type === "Episode" ||
      item.Type === "BoxSet")
  );
}

async function readLimitedImage(
  response: Response,
): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get(
    "content-length",
  );

  if (declaredLength !== null) {
    const length = Number(declaredLength);

    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_IMAGE_BYTES
    ) {
      throw new Error("Invalid image size.");
    }
  }

  if (!response.body) {
    throw new Error("Image body missing.");
  }

  const reader = response.body.getReader();

  const chunks: Uint8Array[] = [];

  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;

      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Image exceeds size limit.");
      }

      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error("Empty image.");
  }

  const bytes = new Uint8Array(totalBytes);

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes.buffer;
}

async function getTrickplay(
  serverUrl: string,
  userId: string,
  itemId: string,
  sourceId: string,
  authorization: string,
): Promise<Response> {
  const url = new URL("/Items", serverUrl);
  url.search = new URLSearchParams({
    UserId: userId,
    Ids: itemId,
    Fields: "Trickplay",
    Limit: "1",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  if (!response.ok) return errorResponse(502, "Preview metadata unavailable.");

  const data: unknown = await response.json();
  const item = isRecord(data) && Array.isArray(data.Items) ? data.Items[0] : null;
  const trickplay = isRecord(item) && isRecord(item.Trickplay)
    ? item.Trickplay : null;
  const sizes = trickplay?.[sourceId];
  const profiles = isRecord(sizes) ? Object.values(sizes).filter(isRecord) : [];
  const valid = profiles.flatMap((profile) => {
    const { Width, Height, TileWidth, TileHeight, Interval, ThumbnailCount } = profile;
    const numbers = [Width, Height, TileWidth, TileHeight, Interval, ThumbnailCount];
    if (!numbers.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0)) {
      return [];
    }
    const [width, height, columns, rows, interval, count] = numbers as number[];
    if (width > 1024 || height > 1024 || columns > 100 || rows > 100) return [];
    return [{ width, height, columns, rows, interval, count }];
  });
  const profile = valid.sort((a, b) => a.width - b.width)[0];
  if (!profile) return errorResponse(404, "Preview thumbnails unavailable.");
  return Response.json(profile, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(
  request: NextRequest,
): Promise<Response> {
  const query = request.nextUrl.searchParams;

  const itemIds = query.getAll("id");
  const types = query.getAll("type");
  const preview = types[0] === "Trickplay";
  const source = query.get("source");
  const width = query.get("width");
  const tile = query.get("tile");
  const allowed = preview ? ["id", "type", "source", "width", "tile"] : ["id", "type"];

  if (
    [...query.keys()].some(
      (key) => !allowed.includes(key) || query.getAll(key).length !== 1,
    ) ||
    itemIds.length !== 1 ||
    types.length !== 1 ||
    !ITEM_ID_PATTERN.test(itemIds[0]) ||
    !validArtworkType(types[0]) ||
    (preview && (
      !source || !ITEM_ID_PATTERN.test(source) ||
      ((width === null) !== (tile === null)) ||
      (width !== null && !/^[1-9][0-9]{0,3}$/.test(width)) ||
      (tile !== null && !/^(0|[1-9][0-9]{0,5})$/.test(tile))
    ))
  ) {
    return errorResponse(
      400,
      "Invalid artwork request.",
    );
  }

  const itemId = itemIds[0];
  const type = types[0];

  try {
    const sessionToken = await readSessionCookie();

    if (!sessionToken) {
      return errorResponse(
        401,
        "Authentication required.",
      );
    }

    const session = getAuthenticatedSession(
      sessionToken,
    );

    if (!session) {
      return errorResponse(
        401,
        "Authentication required.",
      );
    }

    const accessToken =
      getAuthenticatedJellyfinAccessToken(
        sessionToken,
      );

    if (!accessToken) {
      return errorResponse(
        401,
        "Authentication required.",
      );
    }

    const serverUrl = getServerUrl();

    const authorization =
      `MediaBrowser Token="${accessToken}"`;

    const canAccess = await verifyMediaAccess(
      serverUrl,
      session.jellyfinUserId,
      itemId,
      authorization,
    );

    if (!canAccess) {
      return errorResponse(
        404,
        "Artwork unavailable.",
      );
    }

    const sourceId = source ?? itemId;
    if (preview && width === null) {
      return await getTrickplay(serverUrl, session.jellyfinUserId, itemId, sourceId, authorization);
    }

    const imagePath = preview
      ? `/Videos/${itemId}/Trickplay/${width}/${tile}.jpg`
      : type === "Backdrop"
        ? `/Items/${itemId}/Images/Backdrop/0`
        : `/Items/${itemId}/Images/Primary`;

    const imageUrl = new URL(
      imagePath,
      serverUrl,
    );

    if (preview) {
      imageUrl.searchParams.set("MediaSourceId", sourceId);
    } else {
      imageUrl.searchParams.set("maxWidth", type === "Backdrop" ? "1280" : "600");
      imageUrl.searchParams.set("quality", "80");
    }

    const imageResponse = await fetch(imageUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(
        REQUEST_TIMEOUT_MS,
      ),
      headers: {
        Authorization: authorization,
        Accept: "image/*",
      },
    });

    if (
      imageResponse.status === 404 ||
      imageResponse.status === 204
    ) {
      return errorResponse(
        404,
        "Artwork unavailable.",
      );
    }

    if (!imageResponse.ok) {
      return errorResponse(
        502,
        "Artwork temporarily unavailable.",
      );
    }

    const contentType = imageResponse.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();

    const allowedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ]);

    if (
      !contentType ||
      !allowedTypes.has(contentType)
    ) {
      return errorResponse(
        502,
        "Invalid artwork response.",
      );
    }

    const bytes = await readLimitedImage(
      imageResponse,
    );

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control":
          "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; sandbox",
      },
    });
  } catch {
    return errorResponse(
      503,
      "Artwork temporarily unavailable.",
    );
  }
}
