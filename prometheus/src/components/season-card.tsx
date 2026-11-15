"use client";

import { claimTrailerPreview, releaseTrailerPreview } from "@/components/trailer-preview-owner";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface Season {
  id: string;
  title: string;
  number: number | null;
  hasPoster: boolean;
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

function youtubeEmbed(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      ["youtube.com", "www.youtube.com", "m.youtube.com",
       "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)
    ) {
      videoId =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ??
        "";
    }

    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;

    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=0&controls=0&rel=0`;
  } catch {
    return null;
  }
}

export default function SeasonCard({
  season,
  seriesId,
  seriesHasPoster,
  selected,
  onSelect,
}: {
  season: Season;
  seriesId: string;
  seriesHasPoster: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [active, setActive] = useState(false);
  const [started, setStarted] = useState(false);
  const [trailers, setTrailers] = useState<TrailerResponse | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [seasonImageFailed, setSeasonImageFailed] = useState(false);
  const [seriesImageFailed, setSeriesImageFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewOwner = useRef(Symbol("trailer preview"));
  const iframePreview = useRef<HTMLIFrameElement>(null);
  const timer = useRef<number | null>(null);
  const requested = useRef(false);

  async function loadTrailers() {
    if (requested.current) return;
    requested.current = true;

    try {
      const response = await fetch(
        `/api/season-trailer?id=${encodeURIComponent(season.id)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error("Trailer lookup failed.");

      const value = await response.json();
      if (
        !value ||
        !Array.isArray(value.localTrailers) ||
        !Array.isArray(value.remoteTrailers)
      ) {
        throw new Error("Invalid trailer response.");
      }

      setTrailers(value as TrailerResponse);
    } catch {
      setTrailers({ localTrailers: [], remoteTrailers: [] });
    }
  }

  function activate() {
    claimTrailerPreview(previewOwner.current, deactivate);
    if (timer.current) window.clearTimeout(timer.current);
    setActive(true);
    void loadTrailers();
  }

  function deactivate() {
    releaseTrailerPreview(previewOwner.current);
    if (timer.current) window.clearTimeout(timer.current);
    videoRef.current?.pause();
    if (iframePreview.current) iframePreview.current.src = "about:blank";
    setActive(false);
    setStarted(false);
    setSoundBlocked(false);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video || !trailers?.localTrailers[0] || videoFailed) return;

    video.muted = false;
    void video.play().catch(() => setSoundBlocked(true));
    return () => video.pause();
  }, [active, trailers, videoFailed]);

  useEffect(() => {
    const owner = previewOwner.current;
    return () => {
      releaseTrailerPreview(owner);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const localTrailer = trailers?.localTrailers[0] ?? null;
  const remoteTrailer = trailers?.remoteTrailers[0] ?? null;
  const remoteEmbed =
    (!localTrailer || videoFailed) && remoteTrailer
      ? youtubeEmbed(remoteTrailer.url)
      : null;

  return (
    <button
      type="button"
      className={`prometheus-season-card${selected ? " is-selected" : ""}${started ? " is-playing" : ""}`}
      aria-pressed={selected}
      aria-label={`Select ${season.title}`}
      onClick={onSelect}
      onMouseEnter={() => {
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(activate, 550);
      }}
      onMouseLeave={deactivate}
      onFocus={activate}
      onBlur={deactivate}
    >
      {season.hasPoster && !seasonImageFailed ? (
        <Image
          src={`/api/artwork?id=${encodeURIComponent(season.id)}&type=Primary`}
          alt={`${season.title} artwork`}
          fill
          unoptimized
          sizes="190px"
          onError={() => setSeasonImageFailed(true)}
          className="prometheus-season-art"
        />
      ) : seriesHasPoster && !seriesImageFailed ? (
        <Image
          src={`/api/artwork?id=${encodeURIComponent(seriesId)}&type=Primary`}
          alt=""
          fill
          unoptimized
          sizes="190px"
          onError={() => setSeriesImageFailed(true)}
          className="prometheus-season-art"
        />
      ) : (
        <span className="prometheus-season-art prometheus-season-art-fallback" />
      )}

      {active && localTrailer && !videoFailed && (
        <video
          ref={videoRef}
          src={`/api/playback/stream?id=${encodeURIComponent(localTrailer.id)}`}
          autoPlay
          playsInline
          preload="metadata"
          className="prometheus-season-preview"
          onPlaying={() => setStarted(true)}
          onEnded={() => setStarted(false)}
          onError={() => { setStarted(false); setVideoFailed(true); }}
        />
      )}

      {active && !localTrailer && remoteEmbed && (
        <iframe
          ref={iframePreview}
          title={`${season.title} trailer`}
          src={remoteEmbed}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          className="prometheus-season-preview"
          onLoad={() => setStarted(true)}
        />
      )}

      {active && soundBlocked && (
        <span className="prometheus-season-sound">Select to play preview with sound</span>
      )}

      {!started && (
        <span className="prometheus-season-info">
          <strong>{season.title}</strong>
        </span>
      )}
    </button>
  );
}
