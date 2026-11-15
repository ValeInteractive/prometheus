import { isTrustedPrometheusOrigin } from "@/lib/auth/trusted-origin";
import { readSessionCookie } from "@/lib/auth/session-cookies";
import { getAuthenticatedSession, getAuthenticatedJellyfinAccessToken } from "@/lib/auth/session-service";
import { getJellyfinBaseUrl } from "@/lib/jellyfin/client";

const idPattern = /^[a-f0-9]{32}$/i;

export async function POST(request: Request) {
  if (!isTrustedPrometheusOrigin(request.headers.get("origin"))) {
    return new Response(null, { status: 403 });
  }

  try {
    const { id, action } = await request.json();
    if (typeof id !== "string" || !idPattern.test(id) ||
        !["favourite", "watched", "remove-resume"].includes(action)) {
      return new Response(null, { status: 400 });
    }
    const cookie = await readSessionCookie();
    const session = cookie ? getAuthenticatedSession(cookie) : null;
    const token = cookie ? getAuthenticatedJellyfinAccessToken(cookie) : null;
    if (!session || !token || !idPattern.test(session.jellyfinUserId)) {
      return new Response(null, { status: 401 });
    }

    const userId = session.jellyfinUserId;
    const origin = getJellyfinBaseUrl();
    const headers = { Authorization: `MediaBrowser Token="${token}"` };
    const options = { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) } as const;
    const access = await fetch(new URL(`/Users/${userId}/Items/${id}`, origin), options);
    if (!access.ok) return new Response(null, { status: 404 });
    const item = await access.json();
    if (item.Id?.toLowerCase() !== id.toLowerCase() || !["Movie", "Episode", "Series"].includes(item.Type) ||
        (action === "remove-resume" && item.Type === "Series")) {
      return new Response(null, { status: 400 });
    }

    const endpoint = action === "favourite" ? `/Users/${userId}/FavoriteItems/${id}`
      : action === "watched" ? `/Users/${userId}/PlayedItems/${id}`
      : `/UserItems/${id}/UserData?userId=${userId}`;
    const response = await fetch(new URL(endpoint, origin), {
      ...options,
      method: "POST",
      ...(action === "remove-resume" ? {
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ PlaybackPositionTicks: 0 }),
      } : {}),
    });
    return new Response(null, { status: response.ok ? 204 : 502 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
