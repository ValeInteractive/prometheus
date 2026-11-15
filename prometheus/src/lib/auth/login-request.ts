import "server-only";

import { isTrustedPrometheusOrigin } from "./trusted-origin";

const MAX_LOGIN_BODY_BYTES = 4096;
const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 1024;

export interface LoginCredentials {
  username: string;
  password: string;
}

export class LoginRequestError extends Error {
  constructor(
    public readonly status: number,
  ) {
    super("Invalid login request.");
    this.name = "LoginRequestError";
  }
}


export function validateLoginOrigin(
  request: Request,
): void {
  if (!isTrustedPrometheusOrigin(request.headers.get("origin"))) {
    throw new LoginRequestError(403);
  }
}

export function validateLoginContentType(
  request: Request,
): void {
  const contentType = request.headers.get("content-type");

  if (
    !contentType ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      contentType.trim(),
    )
  ) {
    throw new LoginRequestError(415);
  }
}

export async function parseLoginCredentials(
  request: Request,
): Promise<LoginCredentials> {
  validateLoginOrigin(request);
  validateLoginContentType(request);

  const declaredLength = request.headers.get("content-length");

  if (declaredLength !== null) {
    if (
      !/^\d+$/.test(declaredLength) ||
      !Number.isSafeInteger(Number(declaredLength)) ||
      Number(declaredLength) > MAX_LOGIN_BODY_BYTES
    ) {
      throw new LoginRequestError(413);
    }
  }

  let body: Uint8Array;

  try {
    const reader = request.body?.getReader();

    if (!reader) {
      throw new Error("Missing body.");
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const result = await reader.read();

        if (result.done) {
          break;
        }

        totalBytes += result.value.byteLength;

        if (totalBytes > MAX_LOGIN_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new LoginRequestError(413);
        }

        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }

    body = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch (error) {
    if (error instanceof LoginRequestError) {
      throw error;
    }

    throw new LoginRequestError(400);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    throw new LoginRequestError(400);
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new LoginRequestError(400);
  }

  const credentials = payload as Record<string, unknown>;

  if (
    Object.keys(credentials).length !== 2 ||
    !Object.hasOwn(credentials, "username") ||
    !Object.hasOwn(credentials, "password") ||
    typeof credentials.username !== "string" ||
    typeof credentials.password !== "string" ||
    !credentials.username.trim() ||
    !credentials.password ||
    credentials.username.length > MAX_USERNAME_LENGTH ||
    credentials.password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new LoginRequestError(400);
  }

  return {
    username: credentials.username,
    password: credentials.password,
  };
}
