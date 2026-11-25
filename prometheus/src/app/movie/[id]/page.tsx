"use client";

import Image from "next/image";
import Link from "next/link";
import PrimaryPlaybackLink from "@/components/primary-playback-link";
import PrometheusHeader from "@/components/prometheus-header";
import RandomUnwatched from "@/components/random-unwatched";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import MovieCard, {
  type MovieCardItem,
} from "@/components/movie-card";

interface MovieDetails extends MovieCardItem {
  communityRating: number | null;
  runtimeTicks: number | null;
  playbackPositionTicks?: number | null;
  genres: string[];
  hasBackdrop: boolean;
}

interface MovieResponse {
  movie: MovieDetails;
  localTrailers: Array<{ id: string; title: string }>;
  remoteTrailers: Array<{ url: string; title: string }>;
  similar: MovieCardItem[];
  collections?: { id: string; title: string }[];
}

type PageState =
  | { status: "loading" }
  | { status: "login" }
  | { status: "error" }
  | { status: "ready"; data: MovieResponse };

function validResponse(value: unknown): value is MovieResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const movie = data.movie as Record<string, unknown> | null;

  return Boolean(
    movie &&
    typeof movie.id === "string" &&
    typeof movie.title === "string" &&
    typeof movie.hasPoster === "boolean" &&
    Array.isArray(data.localTrailers) &&
    Array.isArray(data.remoteTrailers) &&
    Array.isArray(data.similar),
  );
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

    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=0&controls=1&rel=0`;
  } catch {
    return null;
  }
}

function MovieDetailsPageContent() {
  const params = useParams();
  const query = useSearchParams();
  const genre = query.get("genre")?.trim();
  const random = query.get("random");
  const id = typeof params.id === "string" ? params.id : "";
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [showTrailer, setShowTrailer] = useState(false);

  useEffect(() => {
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      return;
    }

    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `/api/movie?id=${encodeURIComponent(id)}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (response.status === 401) {
          setState({ status: "login" });
          return;
        }
        if (!response.ok) throw new Error("Movie unavailable.");

        const payload: unknown = await response.json();
        if (!validResponse(payload)) throw new Error("Invalid movie response.");

        setState({ status: "ready", data: payload });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    }

    void load();
    return () => controller.abort();
  }, [id]);

  if (state.status === "loading" && /^[a-f0-9]{32}$/i.test(id)) {
    return (
      <main className="min-h-screen bg-[#090807] p-8 text-white">
        <p role="status" className="text-neutral-400">Loading movie…</p>
      </main>
    );
  }

  if (state.status === "login") {
    return (
      <main className="min-h-screen bg-[#090807] p-8 text-white">
        <h1 className="text-2xl font-bold">Sign in to view this movie</h1>
        <Link href="/login" className="mt-5 inline-block text-[#c9ad7c] underline">
          Sign In
        </Link>
      </main>
    );
  }

  if (state.status !== "ready") {
    return (
      <main className="min-h-screen bg-[#090807] p-8 text-white">
        <h1 className="text-2xl font-bold">Movie unavailable</h1>
        <Link href="/" className="mt-5 inline-block text-[#c9ad7c] underline">
          Return to Prometheus
        </Link>
      </main>
    );
  }

  const { movie, localTrailers, remoteTrailers, similar, collections = [] } = state.data;
  const localTrailer = localTrailers[0] ?? null;
  const remoteTrailer = remoteTrailers[0] ?? null;
  const remoteEmbed = remoteTrailer ? youtubeEmbed(remoteTrailer.url) : null;
  const runtime = movie.runtimeTicks
    ? Math.round(movie.runtimeTicks / 600_000_000)
    : null;

  return (
    <main className="prometheus-detail-page min-h-screen bg-[#090807] text-white">
      <PrometheusHeader />

      <div className="prometheus-detail-content mx-auto space-y-12">
        <section className="prometheus-tv-detail" data-has-backdrop={Boolean(movie.hasBackdrop)}
              style={movie.hasBackdrop ? { backgroundImage:
                `linear-gradient(90deg, #080808f5 12%, #080808a0 47%, transparent), linear-gradient(0deg, #080808, transparent 45%), url("/api/artwork?id=${encodeURIComponent(movie.id)}&type=Backdrop")` } : undefined}>
          <div className="prometheus-tv-detail-poster w-44 shrink-0">
            {movie.hasPoster ? (
              <Image
                src={`/api/artwork?id=${encodeURIComponent(movie.id)}&type=Primary`}
                alt={`${movie.title} poster`}
                width={400}
                height={600}
                unoptimized
                className="w-full rounded-xl object-cover"
              />
            ) : (
              <div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-neutral-800 p-4 text-center">
                {movie.title}
              </div>
            )}
          </div>

          <div className="prometheus-tv-detail-copy">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-[#c9ad7c]">
              PROMETHEUS · MOVIE
            </p>
            <h1 className="text-4xl font-bold md:text-5xl">{movie.title}</h1>

            <p className="mt-4 text-neutral-300">
              {movie.productionYear ?? "Year unknown"}
              {movie.communityRating !== null
                ? ` · ★ ${movie.communityRating.toFixed(1)}`
                : ""}
              {runtime ? ` · ${runtime} min` : ""}
              {movie.genres.length ? ` · ${movie.genres.slice(0, 3).join(", ")}` : ""}
            </p>

            {movie.overview && (
              <p className="mt-5 max-w-3xl leading-7 text-neutral-300">
                {movie.overview}
              </p>
            )}

            <div className="prometheus-tv-detail-actions">
              <PrimaryPlaybackLink key={movie.id} id={movie.id}
                label={(movie.playbackPositionTicks ?? 0) >= 300_000_000 ? "Resume Movie" : "Play Movie"} />
              {(random === "my-list" || (random === "genre" && genre)) && (
                <RandomUnwatched key={movie.id} genre={random === "genre" ? genre : undefined} currentId={movie.id} />
              )}
              {(localTrailer || remoteTrailer) && (
                <button
                  type="button"
                  onClick={() => setShowTrailer((value) => !value)}
                  className="inline-flex min-h-12 items-center rounded-lg border border-white/30 px-6 py-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  {showTrailer ? "Hide Trailer" : "Watch Trailer"}
                </button>
              )}
            </div>
          </div>
        </section>

        {showTrailer && localTrailer && (
          <section aria-label="Movie trailer" className="space-y-4">
            <h2 className="text-2xl font-bold">{localTrailer.title}</h2>
            <video
              controls
              playsInline
              className="aspect-video w-full max-w-4xl rounded-xl bg-black"
              src={`/api/playback/stream?id=${encodeURIComponent(localTrailer.id)}`}
            />
          </section>
        )}

        {showTrailer && !localTrailer && remoteTrailer && (
          <section aria-label="Movie trailer" className="space-y-4">
            <h2 className="text-2xl font-bold">{remoteTrailer.title}</h2>
            {remoteEmbed ? (
              <iframe
                title={`${movie.title} trailer`}
                src={remoteEmbed}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="aspect-video w-full max-w-4xl rounded-xl bg-black"
              />
            ) : (
              <a
                href={remoteTrailer.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-white/30 px-5 py-3 text-[#c9ad7c] underline"
              >
                Open trailer
              </a>
            )}
          </section>
        )}

        {collections.length > 0 && (
          <section aria-label="Collections" className="space-y-3">
            <h2 className="text-2xl font-bold">Collections</h2>
            <div className="flex flex-wrap gap-3">
              {collections.map((collection) => (
                <Link key={collection.id} href={`/collections/${collection.id}`}
                  className="prometheus-button prometheus-button-secondary">{collection.title}</Link>
              ))}
            </div>
          </section>
        )}

        {similar.length > 0 && (
          <section className="prometheus-tv-related space-y-5">
            <h2 className="text-2xl font-bold">More Like This</h2>
            <div className="prometheus-card-grid">
              {similar.map((item) => (
                <MovieCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function MovieDetailsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#090807] p-8 text-white">
          <p role="status" className="text-neutral-400">Loading movie…</p>
        </main>
      }
    >
      <MovieDetailsPageContent />
    </Suspense>
  );
}
