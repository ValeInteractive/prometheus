import "server-only";

const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/i;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function isPrometheusDirectSource(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.Id !== "string" ||
    !ITEM_ID_PATTERN.test(value.Id) ||
    !["mp4", "m4v"].includes(
      String(value.Container).toLowerCase(),
    ) ||
    value.IsRemote === true
  ) {
    return false;
  }

  if (!Array.isArray(value.MediaStreams)) {
    return false;
  }

  const streams = value.MediaStreams.filter(isRecord);

  const videos = streams.filter(
    (stream) => stream.Type === "Video",
  );

  const audios = streams.filter(
    (stream) => stream.Type === "Audio",
  );

  return (
    videos.length === 1 &&
    String(videos[0].Codec).toLowerCase() === "h264" &&
    audios.length <= 1 &&
    audios.every(
      (stream) =>
        ["aac", "mp3"].includes(
          String(stream.Codec).toLowerCase(),
        ),
    )
  );
}
