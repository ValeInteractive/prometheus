"use client";

import { claimTrailerPreview, releaseTrailerPreview } from "@/components/trailer-preview-owner";

import PrometheusPoster from "@/components/prometheus-poster";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface MovieCardItem {
  id: string;
  title: string;
  overview: string | null;
  productionYear: number | null;
  communityRating: number | null;
  hasPoster: boolean;
  hasBackdrop?: boolean;
  genres?: string[];
}

interface Trailer {
  id: string;
  title: string;
}

interface RemoteTrailer {
  url: string;
  title: string;
}

interface TrailerResponse {
  localTrailers: Trailer[];
  remoteTrailers: RemoteTrailer[];
}

export function youtubeEmbed(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "www.youtube-nocookie.com"
    ) {
      videoId =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ??
        "";
    }

    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;

    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=0&controls=0&rel=0&loop=1&playlist=${videoId}&playsinline=1`;
  } catch {
    return null;
  }
}

export default function MovieCard({
  item, homeRail = false, seriesPreview = false,
}: { item: MovieCardItem; homeRail?: boolean; seriesPreview?: boolean }) {
  const router = useRouter();
  const titlePath = `/${seriesPreview ? "series" : "movie"}/${encodeURIComponent(item.id)}`;
  const playPath = seriesPreview ? titlePath : `/watch/${encodeURIComponent(item.id)}`;
  const [active, setActive] = useState(false);
  const [trailerStarted, setTrailerStarted] = useState(false);
  const [trailers, setTrailers] = useState<TrailerResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewOwner = useRef(Symbol("trailer preview"));
  const timer = useRef<number | null>(null);
  const requested = useRef(false);

  async function loadTrailers() {
    if (requested.current) return;
    requested.current = true;

    try {
      const query = new URLSearchParams({
        id: item.id,
        mode: "trailers",
      });
      const endpoint = seriesPreview
        ? `/api/season-trailer?id=${encodeURIComponent(item.id)}&type=Series`
        : `/api/movie?${query}`;
      const response = await fetch(endpoint, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Trailer lookup failed.");

      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray((value as TrailerResponse).localTrailers) ||
        !Array.isArray((value as TrailerResponse).remoteTrailers)
      ) {
        throw new Error("Invalid trailer response.");
      }

      setTrailers(value as TrailerResponse);
    } catch {
      setFailed(true);
    }
  }

  function activate() {
    claimTrailerPreview(previewOwner.current, deactivate);
    if (timer.current) window.clearTimeout(timer.current);
    setActive(true);
    void loadTrailers();
  }

  function startHover() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(activate, 550);
  }

  function deactivate() {
    releaseTrailerPreview(previewOwner.current);
    if (timer.current) window.clearTimeout(timer.current);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (iframeRef.current) {
      iframeRef.current.src = "about:blank";
    }
    setActive(false);
    setTrailerStarted(false);
    setSoundBlocked(false);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;

    video.muted = seriesPreview;
    void video.play().catch(() => setSoundBlocked(true));

    return () => video.pause();
  }, [active, seriesPreview, trailers]);

  useEffect(() => {
    const owner = previewOwner.current;
    return () => {
      releaseTrailerPreview(owner);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const localTrailer = trailers?.localTrailers[0] ?? null;
  const remoteTrailer = trailers?.remoteTrailers[0] ?? null;
  const remoteEmbed = seriesPreview
    ? trailers?.remoteTrailers.map((trailer) => youtubeEmbed(trailer.url)).find(Boolean) ?? null
    : remoteTrailer ? youtubeEmbed(remoteTrailer.url) : null;
  const showRemotePreview = active && (!localTrailer || (seriesPreview && failed)) && remoteEmbed;

  return (
    <article
      className={`prometheus-card prometheus-movie-card${active && trailerStarted ? " is-playing" : ""}`}
      aria-label={`${item.title}, ${seriesPreview ? "series" : "movie"}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        deactivate();
        router.push(playPath);
      }}
      onMouseEnter={homeRail ? undefined : startHover}
      onMouseLeave={homeRail ? undefined : deactivate}
      onFocusCapture={startHover}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          deactivate();
        }
      }}
    >
      <div className="relative mb-3 aspect-[2/3] overflow-hidden rounded-lg bg-neutral-900">
        <Link
          href={playPath}
          aria-label={`${seriesPreview ? "Browse" : "Play"} ${item.title}`}
          data-poster-id={item.id}
          data-poster-title={item.title}
          data-poster-genres={item.genres ? JSON.stringify(item.genres) : undefined}
          data-poster-play={playPath}
          className="absolute inset-0"
          data-home-backdrop={homeRail && item.hasBackdrop ? "true" : undefined}
          style={homeRail && item.hasBackdrop ? { backgroundImage: `url("/api/artwork?id=${encodeURIComponent(item.id)}&type=Backdrop")` } : undefined}
          onClick={deactivate}
        >
          <PrometheusPoster key={item.id} id={item.id} title={item.title} hasPoster={item.hasPoster} />
        </Link>

        {active && localTrailer && (!seriesPreview || !failed) && (
          <video
            ref={videoRef}
            src={`/api/playback/stream?id=${encodeURIComponent(localTrailer.id)}`}
            autoPlay
            muted={seriesPreview}
            playsInline
            preload="metadata"
            className="prometheus-card-preview"
            style={seriesPreview && !trailerStarted ? { opacity: 0 } : undefined}
            onPlaying={() => setTrailerStarted(true)}
            onEnded={() => setTrailerStarted(false)}
            onError={() => { setTrailerStarted(false); setFailed(true); }}
          />
        )}

        {showRemotePreview && (
          <iframe
            ref={iframeRef}
            title={`${item.title} trailer`}
            src={showRemotePreview}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            className="prometheus-card-preview"
            onLoad={() => setTrailerStarted(true)}
          />
        )}

        {active && !seriesPreview && soundBlocked && (
          <button
            type="button"
            className="prometheus-preview-sound"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.muted = false;
              void video.play()
                .then(() => setSoundBlocked(false))
                .catch(() => setSoundBlocked(true));
            }}
          >
            Play preview with sound
          </button>
        )}
      </div>

      {(!trailerStarted || homeRail) && (
        <div className="px-1 pb-2">
          <h3 className="line-clamp-2 text-base font-semibold text-white">
            {item.title}
          </h3>

          <p className="mt-1 text-sm text-neutral-300">
            {item.productionYear ?? "Year unknown"}
            {item.communityRating !== null
              ? ` · ★ ${item.communityRating.toFixed(1)}`
              : ""}
            {seriesPreview ? " · Series" : " · Movie"}
          </p>

          {(!active || homeRail) && item.overview && (
            <p className="mt-2 line-clamp-2 text-sm text-neutral-300">
              {item.overview}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={titlePath}
              className="inline-flex min-h-10 items-center rounded-md border border-white/30 bg-black/50 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={deactivate}
            >
              More Info
            </Link>
          </div>

          {active && !trailers && !failed && (
            <p className="mt-2 text-xs text-neutral-400" role="status">
              Finding trailer…
            </p>
          )}

          {active && trailers &&
            trailers.localTrailers.length === 0 &&
            trailers.remoteTrailers.length === 0 && (
              <p className="mt-2 text-xs text-neutral-400">
                No trailer available
              </p>
            )}
        </div>
      )}
    </article>
  );
}
