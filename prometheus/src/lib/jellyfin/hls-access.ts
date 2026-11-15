import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const ID = /^[a-f0-9]{32}$/i;
const SIGNATURE = /^[a-f0-9]{64}$/i;
const MAX_RESOURCE_LENGTH = 4096;

const LIFETIME_SECONDS = 12 * 60 * 60;

export function validateHlsResource(
  resource: string,
  itemId: string,
): "playlist" | "segment" | null {
  if (
    !ID.test(itemId) ||
    !resource ||
    resource.length > MAX_RESOURCE_LENGTH ||
    resource.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(resource) ||
    resource.startsWith("//") ||
    !resource.startsWith("/")
  ) {
    return null;
  }

  if (
    /%(?:2f|5c|2e|00)/i.test(resource) ||
    resource.includes("/../") ||
    resource.includes("/./")
  ) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(
      resource,
      "http://localhost",
    );
  } catch {
    return null;
  }

  if (
    parsed.origin !== "http://localhost" ||
    parsed.hash ||
    parsed.pathname + parsed.search !== resource
  ) {
    return null;
  }

  const expected = itemId.toLowerCase();

  // Jellyfin may use either a compact 32-character ID
  // or the equivalent hyphenated UUID in HLS routes.
  const mediaIdPattern =
    "([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-" +
    "[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";

  const playlistMatch = new RegExp(
    `^/Videos/${mediaIdPattern}/(?:master|main)\\.m3u8$`,
    "i",
  ).exec(parsed.pathname);

  const segmentMatch = new RegExp(
    `^/Videos/${mediaIdPattern}/hls1/` +
    `[a-zA-Z0-9_-]+/(?:-1|[0-9]+)\\.(?:ts|mp4|m4s)$`,
    "i",
  ).exec(parsed.pathname);

  const match = playlistMatch ?? segmentMatch;

  if (
    !match ||
    match[1].replace(/-/g, "").toLowerCase() !== expected
  ) {
    return null;
  }

  const seen = new Set<string>();

  for (const [key, value] of parsed.searchParams) {
    const normalized = key.toLowerCase();

    if (
      !/^[a-z][a-z0-9_-]*$/i.test(key) ||
      key.length > 80 ||
      value.length > 1024 ||
      seen.has(normalized) ||
      /^(?:apikey|api_key|token|access_token|authorization|password|path|url)$/i
        .test(key)
    ) {
      return null;
    }

    seen.add(normalized);
  }

  return playlistMatch ? "playlist" : "segment";
}

function secret(): string {
  const configured =
    process.env.PROMETHEUS_RATE_LIMIT_SECRET;

  if (!configured || configured.length < 32) {
    throw new Error(
      "HLS signing secret unavailable.",
    );
  }

  return configured;
}

function sign(
  itemId: string,
  userId: string,
  resource: string,
  expires: string,
): string {
  return createHmac("sha256", secret())
    .update("PROMETHEUS-HLS-v1\n")
    .update(itemId.toLowerCase())
    .update("\n")
    .update(userId.toLowerCase())
    .update("\n")
    .update(expires)
    .update("\n")
    .update(resource)
    .digest("hex");
}

export function createSignedHlsUrl(
  itemId: string,
  userId: string,
  resource: string,
): string {
  if (
    !ID.test(itemId) ||
    !ID.test(userId) ||
    !validateHlsResource(resource, itemId)
  ) {
    throw new Error("Invalid HLS resource.");
  }

  const expires = String(
    Math.floor(Date.now() / 1000) +
      LIFETIME_SECONDS,
  );

  const signature = sign(
    itemId,
    userId,
    resource,
    expires,
  );

  const params = new URLSearchParams({
    id: itemId,
    resource,
    expires,
    signature,
  });

  return `/api/playback/hls?${params}`;
}

export function verifySignedHlsRequest(
  itemId: string,
  userId: string,
  resource: string,
  expires: string,
  signature: string,
): boolean {
  if (
    !ID.test(itemId) ||
    !ID.test(userId) ||
    !validateHlsResource(resource, itemId) ||
    !/^[0-9]{10,12}$/.test(expires) ||
    !SIGNATURE.test(signature)
  ) {
    return false;
  }

  const expiration = Number(expires);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(expiration) ||
    expiration <= now ||
    expiration > now + LIFETIME_SECONDS
  ) {
    return false;
  }

  const expected = Buffer.from(
    sign(itemId, userId, resource, expires),
    "hex",
  );

  const supplied = Buffer.from(
    signature,
    "hex",
  );

  return (
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}
