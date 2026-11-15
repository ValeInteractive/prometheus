import "server-only";

const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/i;

const MAX_PLAYLIST_BYTES = 1024 * 1024;

const MAX_PLAYLIST_LINES = 10000;

const MAX_URI_LENGTH = 4096;

const MEDIA_ID =
  "(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-" +
  "[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";

const ALLOWED_RESOURCES = [
  new RegExp(
    `^/Videos/${MEDIA_ID}/(?:master|main)\\.m3u8$`,
    "i",
  ),
  new RegExp(
    `^/Videos/${MEDIA_ID}/hls1/` +
      `[a-zA-Z0-9_-]+/(?:-1|[0-9]+)\\.(?:ts|mp4|m4s)$`,
    "i",
  ),
];

export class HlsPlaylistError extends Error {
  constructor() {
    super("Invalid or unsupported HLS playlist.");
    this.name = "HlsPlaylistError";
  }
}

function permittedResource(
  pathname: string,
  itemId: string,
): boolean {
  const match = new RegExp(
    `^/Videos/(${MEDIA_ID})/`,
    "i",
  ).exec(pathname);

  return (
    match !== null &&
    match[1].replace(/-/g, "").toLowerCase() ===
      itemId.toLowerCase() &&
    ALLOWED_RESOURCES.some((pattern) =>
      pattern.test(pathname),
    )
  );
}

export function rewriteHlsResource(
  value: string,
  itemId: string,
  playlistUrl: URL,
  signResource?: (resource: string) => string,
): string {
  if (
    !ITEM_ID_PATTERN.test(itemId) ||
    !value ||
    value.length > MAX_URI_LENGTH ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new HlsPlaylistError();
  }

  // Do not accept scheme-relative or absolute URLs.
  // Even trusted upstream playlists must not become
  // arbitrary network requests.
  if (
    value.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    throw new HlsPlaylistError();
  }

  let resolved: URL;

  try {
    resolved = new URL(value, playlistUrl);
  } catch {
    throw new HlsPlaylistError();
  }

  if (
    resolved.origin !== playlistUrl.origin ||
    resolved.hash ||
    !permittedResource(resolved.pathname, itemId)
  ) {
    throw new HlsPlaylistError();
  }

  // Remove credentials and session-related parameters.
  // The future gateway will authenticate each request.
  for (const key of [...resolved.searchParams.keys()]) {
    if (
      /^(?:apikey|api_key|token|access_token|authorization)$/i.test(
        key,
      )
    ) {
      resolved.searchParams.delete(key);
    }
  }

  const resource =
    resolved.pathname + resolved.search;

  if (signResource) {
    return signResource(resource);
  }

  return (
    `/api/playback/hls?id=${encodeURIComponent(itemId)}` +
    `&resource=${encodeURIComponent(resource)}`
  );
}

export function rewriteHlsPlaylist(
  playlist: string,
  itemId: string,
  playlistUrl: URL,
  signResource?: (resource: string) => string,
): string {
  if (
    !ITEM_ID_PATTERN.test(itemId) ||
    !playlist.startsWith("#EXTM3U") ||
    new TextEncoder().encode(playlist).byteLength >
      MAX_PLAYLIST_BYTES
  ) {
    throw new HlsPlaylistError();
  }

  const lines = playlist.replace(/\r\n/g, "\n").split("\n");

  if (lines.length > MAX_PLAYLIST_LINES) {
    throw new HlsPlaylistError();
  }

  const rewritten = lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return line;
    }

    if (
      trimmed.startsWith("#EXT-X-KEY:") ||
      trimmed.startsWith("#EXT-X-SESSION-KEY:")
    ) {
      // Encrypted HLS requires separately controlled
      // key delivery, which is not implemented yet.
      throw new HlsPlaylistError();
    }

    if (trimmed.startsWith("#EXT-X-MAP:")) {
      const match =
        /^#EXT-X-MAP:URI="([^"]+)"$/.exec(trimmed);

      if (!match) {
        throw new HlsPlaylistError();
      }

      const rewrittenMap = rewriteHlsResource(
        match[1],
        itemId,
        playlistUrl,
        signResource,
      );

      return `#EXT-X-MAP:URI="${rewrittenMap}"`;
    }

    if (
      trimmed.startsWith("#EXT-X-MEDIA:") ||
      trimmed.startsWith("#EXT-X-I-FRAME-STREAM-INF:")
    ) {
      throw new HlsPlaylistError();
    }

    if (trimmed.startsWith("#")) {
      if (/\bURI\s*=/i.test(trimmed)) {
        throw new HlsPlaylistError();
      }

      return line;
    }

    return rewriteHlsResource(
      trimmed,
      itemId,
      playlistUrl,
      signResource,
    );
  });

  return rewritten.join("\n");
}
