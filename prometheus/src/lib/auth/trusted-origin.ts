import "server-only";

function parseOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);

    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== value
    ) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

export function isTrustedPrometheusOrigin(
  suppliedOrigin: string | null,
): boolean {
  if (!suppliedOrigin) {
    return false;
  }

  const supplied = parseOrigin(suppliedOrigin);

  if (!supplied) {
    return false;
  }

  const configured = process.env.PROMETHEUS_ALLOWED_ORIGINS;

  const allowed = configured
    ? configured.split(",").map((value) => value.trim())
    : [process.env.PROMETHEUS_PUBLIC_URL ?? ""];

  return allowed.some((value) => {
    const trusted = parseOrigin(value);
    return trusted !== null && trusted === supplied;
  });
}
