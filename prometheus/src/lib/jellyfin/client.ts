import "server-only";

const REQUEST_TIMEOUT_MS = 10_000;

export class JellyfinConnectionError extends Error {
  constructor() {
    super("Unable to connect to the configured Jellyfin server.");
    this.name = "JellyfinConnectionError";
  }
}

export function getJellyfinBaseUrl(): string {
  const configuredUrl = process.env.JELLYFIN_SERVER_URL;

  if (!configuredUrl) {
    throw new Error("JELLYFIN_SERVER_URL is not configured.");
  }

  const parsedUrl = new URL(configuredUrl);

  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== "/"
  ) {
    throw new Error("Invalid Jellyfin server URL configuration.");
  }

  return parsedUrl.origin;
}

export async function jellyfinHealthCheck(): Promise<boolean> {
  const baseUrl = getJellyfinBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return response.ok;
  } catch {
    throw new JellyfinConnectionError();
  }
}

export async function getJellyfinPublicInfo(): Promise<{
  ServerName?: string;
  Version?: string;
  ProductName?: string;
  StartupWizardCompleted?: boolean;
}> {
  const baseUrl = getJellyfinBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/System/Info/Public`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new JellyfinConnectionError();
    }

    return await response.json();
  } catch {
    throw new JellyfinConnectionError();
  }
}
