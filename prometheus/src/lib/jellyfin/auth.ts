import "server-only";

import { randomUUID } from "node:crypto";

const AUTH_TIMEOUT_MS = 10_000;

export interface JellyfinAuthenticatedUser {
  id: string;
  name: string;
}

export interface JellyfinAuthenticationResult {
  user: JellyfinAuthenticatedUser;
  accessToken: string;
}

export class JellyfinAuthenticationError extends Error {
  constructor() {
    super("Jellyfin authentication failed.");
    this.name = "JellyfinAuthenticationError";
  }
}

function getServerUrl(): string {
  const configured = process.env.JELLYFIN_SERVER_URL;

  if (!configured) {
    throw new Error("Jellyfin server URL is not configured.");
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
    throw new Error("Invalid Jellyfin server configuration.");
  }

  return parsed.origin;
}

interface JellyfinAuthenticationResponse {
  AccessToken?: unknown;
  User?: {
    Id?: unknown;
    Name?: unknown;
  };
}

export async function authenticateJellyfinUser(
  username: string,
  password: string,
): Promise<JellyfinAuthenticationResult> {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username.trim() ||
    !password ||
    username.length > 128 ||
    password.length > 1024
  ) {
    throw new JellyfinAuthenticationError();
  }

  const serverUrl = getServerUrl();
  const deviceId = randomUUID();

  let response: Response;

  try {
    response = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "Authorization":
          `MediaBrowser Client="PROMETHEUS", Device="PROMETHEUS Server", DeviceId="${deviceId}", Version="0.2.0"`,
      },
      body: JSON.stringify({
        Username: username,
        Pw: password,
      }),
    });
  } catch {
    throw new JellyfinAuthenticationError();
  }

  if (!response.ok) {
    throw new JellyfinAuthenticationError();
  }

  let payload: JellyfinAuthenticationResponse;

  try {
    payload = (await response.json()) as JellyfinAuthenticationResponse;
  } catch {
    throw new JellyfinAuthenticationError();
  }

  if (
    typeof payload.AccessToken !== "string" ||
    !payload.AccessToken ||
    typeof payload.User?.Id !== "string" ||
    !payload.User.Id ||
    typeof payload.User.Name !== "string" ||
    !payload.User.Name
  ) {
    throw new JellyfinAuthenticationError();
  }

  return {
    user: {
      id: payload.User.Id,
      name: payload.User.Name,
    },
    accessToken: payload.AccessToken,
  };
}
