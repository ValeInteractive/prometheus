import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import { isIP } from "node:net";

export type LoginRateLimitIdentityType =
  | "account"
  | "ip";

const SECRET_PATTERN = /^[a-f0-9]{64}$/i;

const MAX_USERNAME_LENGTH = 128;

function getRateLimitSecret(): Buffer {
  const secret =
    process.env.PROMETHEUS_RATE_LIMIT_SECRET;

  if (
    !secret ||
    !SECRET_PATTERN.test(secret)
  ) {
    throw new Error(
      "PROMETHEUS_RATE_LIMIT_SECRET must contain exactly 64 hexadecimal characters.",
    );
  }

  return Buffer.from(secret, "hex");
}

function normalizeAccount(
  username: string,
): string {
  if (
    typeof username !== "string" ||
    username.length === 0 ||
    username.length > MAX_USERNAME_LENGTH
  ) {
    throw new Error(
      "Invalid login account identifier.",
    );
  }

  const normalized = username
    .normalize("NFKC")
    .trim()
    .toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_USERNAME_LENGTH
  ) {
    throw new Error(
      "Invalid normalized account identifier.",
    );
  }

  return normalized;
}

function normalizeIp(
  ipAddress: string,
): string {
  if (typeof ipAddress !== "string") {
    throw new Error(
      "Invalid trusted client IP address.",
    );
  }

  const family = isIP(ipAddress);

  if (family === 0) {
    throw new Error(
      "Invalid trusted client IP address.",
    );
  }

  // Node validates IPv4 syntax before this point.
  // Preserve existing IPv4 identifier compatibility.
  if (family === 4) {
    return ipAddress;
  }

  // WHATWG URL parsing canonicalizes IPv6.
  // The hostname includes square brackets.
  const hostname = new URL(
    `http://[${ipAddress}]/`,
  ).hostname;

  const canonical = hostname.slice(1, -1);

  // Normalize IPv4-mapped IPv6 addresses to IPv4.
  // Example: ::ffff:c000:201 -> 192.0.2.1
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(
    canonical,
  );

  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);

    return [
      high >>> 8,
      high & 255,
      low >>> 8,
      low & 255,
    ].join(".");
  }

  return canonical;
}

export function createLoginRateLimitIdentifier(
  type: LoginRateLimitIdentityType,
  value: string,
): string {
  if (type !== "account" && type !== "ip") {
    throw new Error(
      "Invalid login rate-limit identity type.",
    );
  }

  const normalized =
    type === "account"
      ? normalizeAccount(value)
      : normalizeIp(value);

  return createHmac(
    "sha256",
    getRateLimitSecret(),
  )
    .update("prometheus:login-rate-limit:v1")
    .update("\0")
    .update(type)
    .update("\0")
    .update(normalized)
    .digest("hex");
}

export function compareLoginRateLimitIdentifiers(
  first: string,
  second: string,
): boolean {
  if (
    !/^[a-f0-9]{64}$/.test(first) ||
    !/^[a-f0-9]{64}$/.test(second)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(first, "hex"),
    Buffer.from(second, "hex"),
  );
}
