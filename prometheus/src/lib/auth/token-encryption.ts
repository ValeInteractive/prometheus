import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_LENGTH = 8192;
const MAX_USER_ID_LENGTH = 128;

function getEncryptionKey(): Buffer {
  const configured = process.env.PROMETHEUS_TOKEN_ENCRYPTION_KEY;

  if (
    typeof configured !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(configured)
  ) {
    throw new Error("PROMETHEUS token encryption key is not configured.");
  }

  const key = Buffer.from(configured, "hex");

  if (key.length !== KEY_BYTES) {
    throw new Error("Invalid PROMETHEUS token encryption key.");
  }

  return key;
}

function validateUserId(userId: string): void {
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    userId.length > MAX_USER_ID_LENGTH
  ) {
    throw new Error("Invalid Jellyfin user identity.");
  }
}

function getAuthenticatedData(userId: string): Buffer {
  validateUserId(userId);

  return Buffer.from(
    `PROMETHEUS:${VERSION}:JELLYFIN:${userId}`,
    "utf8",
  );
}

export function encryptJellyfinAccessToken(
  accessToken: string,
  jellyfinUserId: string,
): string {
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    Buffer.byteLength(accessToken, "utf8") > MAX_TOKEN_LENGTH
  ) {
    throw new Error("Invalid Jellyfin access token.");
  }

  const key = getEncryptionKey();
  const nonce = randomBytes(NONCE_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_BYTES,
  });

  cipher.setAAD(getAuthenticatedData(jellyfinUserId));

  const encrypted = Buffer.concat([
    cipher.update(accessToken, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    VERSION,
    nonce.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decryptJellyfinAccessToken(
  encryptedToken: string,
  jellyfinUserId: string,
): string {
  if (
    typeof encryptedToken !== "string" ||
    encryptedToken.length > MAX_TOKEN_LENGTH * 2 + 100
  ) {
    throw new Error("Invalid encrypted Jellyfin token.");
  }

  const parts = encryptedToken.split(":");

  if (
    parts.length !== 4 ||
    parts[0] !== VERSION ||
    !/^[a-f0-9]{24}$/.test(parts[1]) ||
    !/^[a-f0-9]{32}$/.test(parts[2]) ||
    !/^(?:[a-f0-9]{2})+$/.test(parts[3]) ||
    parts[3].length > MAX_TOKEN_LENGTH * 2
  ) {
    throw new Error("Invalid encrypted Jellyfin token.");
  }

  const key = getEncryptionKey();

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(parts[1], "hex"),
      { authTagLength: TAG_BYTES },
    );

    decipher.setAAD(getAuthenticatedData(jellyfinUserId));
    decipher.setAuthTag(Buffer.from(parts[2], "hex"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parts[3], "hex")),
      decipher.final(),
    ]);

    const token = decrypted.toString("utf8");

    if (
      !token ||
      decrypted.length > MAX_TOKEN_LENGTH
    ) {
      throw new Error("Invalid decrypted token.");
    }

    return token;
  } catch {
    throw new Error("Unable to decrypt Jellyfin access token.");
  }
}
