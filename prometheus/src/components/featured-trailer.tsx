"use client";

import { useEffect, useState } from "react";
import { youtubeEmbed } from "@/components/movie-card";
import { claimTrailerPreview, releaseTrailerPreview } from "@/components/trailer-preview-owner";

export default function FeaturedTrailer({ id, type }: { id: string; type: "Movie" | "Series" }) {
  const [sources, setSources] = useState<{ local?: string; remote?: string }>({});
  const [stopped, setStopped] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (stopped) return;

    const owner = Symbol("featured trailer");
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const query = new URLSearchParams({ id });
      if (type === "Movie") query.set("mode", "trailers");
      else query.set("type", "Series");

      try {
        const route = type === "Movie" ? "movie" : "season-trailer";
        const response = await fetch(`/api/${route}?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = await response.json() as {
          localTrailers: { id: string }[];
          remoteTrailers: { url: string }[];
        };
        const local = data.localTrailers[0]?.id;
        const remote = data.remoteTrailers
          .map(({ url }) => youtubeEmbed(url))
          .find(Boolean) ?? undefined;

        if (controller.signal.aborted || (!local && !remote)) return;

        claimTrailerPreview(owner, () => {
          controller.abort();
          setStopped(true);
        });
        setSources({ local, remote });
      } catch {
        // Keep the featured artwork if trailer lookup fails.
      }
    }, 550);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      releaseTrailerPreview(owner);
    };
  }, [id, stopped, type]);

  if (stopped || (!sources.local && !sources.remote)) return null;

  return (
    <div aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      style={{ opacity: sources.local && !started ? 0 : 1 }}>
      {sources.local ? (
        <video className="h-full w-full object-cover" autoPlay playsInline
          src={`/api/playback/stream?id=${encodeURIComponent(sources.local)}`}
          onPlaying={() => setStarted(true)}
          onEnded={() => setStopped(true)}
          onError={() => setSources({ remote: sources.remote })} />
      ) : (
        <iframe className="absolute left-1/2 top-1/2 h-full min-h-[52vw] w-full -translate-x-1/2 -translate-y-1/2 border-0"
          title="Featured trailer" tabIndex={-1} allow="autoplay"
          referrerPolicy="strict-origin-when-cross-origin" src={sources.remote} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
    </div>
  );
}
