import "server-only";

import {
  createSignedHlsUrl,
  validateHlsResource,
} from "@/lib/jellyfin/hls-access";

const ID = /^[a-f0-9]{32}$/i;

const CREDENTIAL_PARAMETERS = new Set([
  "apikey",
  "api_key",
  "token",
  "access_token",
  "authorization",
]);

export function createNegotiatedHlsUrl(
  transcodingUrl: unknown,
  itemId: string,
  userId: string,
  jellyfinOrigin: string,
): string | null {
  if (
    typeof transcodingUrl !== "string" ||
    !transcodingUrl.startsWith("/") ||
    transcodingUrl.startsWith("//") ||
    transcodingUrl.length > 4096 ||
    !ID.test(itemId) ||
    !ID.test(userId)
  ) {
    return null;
  }

  try {
    const base = new URL(jellyfinOrigin);

    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.pathname !== "/" ||
      base.search ||
      base.hash ||
      base.username ||
      base.password
    ) {
      return null;
    }

    const url = new URL(transcodingUrl, base);

    if (
      url.origin !== base.origin ||
      url.hash
    ) {
      return null;
    }

    // Jellyfin credentials must never be embedded
    // in the URLs PROMETHEUS returns to browsers.
    for (const key of [...url.searchParams.keys()]) {
      if (
        CREDENTIAL_PARAMETERS.has(
          key.toLowerCase(),
        )
      ) {
        url.searchParams.delete(key);
      }
    }

    const resource = url.pathname + url.search;

    // Only existing approved Jellyfin playlist
    // routes are eligible for signed access.
    if (
      validateHlsResource(resource, itemId) !==
      "playlist"
    ) {
      return null;
    }

    return createSignedHlsUrl(
      itemId,
      userId,
      resource,
    );
  } catch {
    return null;
  }
}
