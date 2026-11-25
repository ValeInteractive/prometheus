"use client";

import PrimaryPlaybackLink from "@/components/primary-playback-link";
import SeasonCard from "@/components/season-card";

import Image from "next/image";
import Link from "next/link";
import PrometheusHeader from "@/components/prometheus-header";

import { useParams } from "next/navigation";

import {
  Suspense,
  useEffect,
  useState,
} from "react";

const ID = /^[a-f0-9]{32}$/i;

interface SeriesInfo {
  id: string;
  title: string;
  overview: string | null;
  productionYear: number | null;
  hasPoster: boolean;
  hasBackdrop?: boolean;
}

interface Season {
  id: string;
  title: string;
  number: number | null;
  hasPoster: boolean;
}

interface Episode {
  id: string;
  title: string;
  overview: string | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  runtimeTicks: number | null;
  playbackPositionTicks: number | null;
  played: boolean;
  hasPoster: boolean;
}

interface SeriesResponse {
  series: SeriesInfo;
  seasons: Season[];
  selectedSeasonId: string | null;
  episodes: Episode[];
}

type SeriesState =
  | { status: "loading" }
  | { status: "login" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      data: SeriesResponse;
    };

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isSeriesResponse(
  value: unknown,
): value is SeriesResponse {
  if (!isRecord(value)) return false;

  const series = value.series;

  if (
    !isRecord(series) ||
    typeof series.id !== "string" ||
    !ID.test(series.id) ||
    typeof series.title !== "string" ||
    typeof series.hasPoster !== "boolean" ||
    !Array.isArray(value.seasons) ||
    !Array.isArray(value.episodes)
  ) {
    return false;
  }

  return (
    value.seasons.every(
      (season: unknown) =>
        isRecord(season) &&
        typeof season.id === "string" &&
        ID.test(season.id) &&
        typeof season.title === "string",
    ) &&
    value.episodes.every(
      (episode: unknown) =>
        isRecord(episode) &&
        typeof episode.id === "string" &&
        ID.test(episode.id) &&
        typeof episode.title === "string",
    )
  );
}

function episodeNumber(
  item: Episode,
): string {
  const season =
    item.seasonNumber !== null
      ? `S${String(item.seasonNumber).padStart(2, "0")}`
      : "";

  const episode =
    item.episodeNumber !== null
      ? `E${String(item.episodeNumber).padStart(2, "0")}`
      : "";

  return [season, episode]
    .filter(Boolean)
    .join(" ");
}

function episodeProgress(
  item: Episode,
): number | null {
  if (
    item.runtimeTicks === null ||
    item.runtimeTicks <= 0 ||
    item.playbackPositionTicks === null ||
    item.playbackPositionTicks <= 0
  ) {
    return null;
  }

  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        item.playbackPositionTicks /
          item.runtimeTicks * 100,
      ),
    ),
  );
}

function EpisodeCard({
  episode,
}: {
  episode: Episode;
}) {
  const progress = episodeProgress(episode);

  return (
    <article className="prometheus-episode-card rounded-xl border border-white/10 bg-neutral-900 p-5">
      <div className="flex flex-col justify-between gap-5 md:flex-row">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-sm font-semibold text-red-400">
            {episodeNumber(episode) || "Episode"}
            {episode.runtimeTicks && episode.runtimeTicks > 0
              ? ` · ${Math.round(episode.runtimeTicks / 600_000_000)} min` : ""}
          </p>

          <h3 className="text-xl font-bold text-white">
            {episode.title}
          </h3>

          {episode.overview && (
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              {episode.overview}
            </p>
          )}

          {episode.played && (
            <p className="mt-3 text-sm text-green-400">
              Watched
            </p>
          )}

          {progress !== null &&
            progress > 0 &&
            !episode.played && (
              <div className="mt-4 max-w-lg">
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-neutral-700"
                  role="progressbar"
                  aria-label={`${episode.title} watched`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div
                    className="h-full rounded-full bg-red-600"
                    style={{
                      width: `${progress}%`,
                    }}
                  />
                </div>

                <p className="mt-2 text-xs text-neutral-400">
                  {episode.runtimeTicks && episode.playbackPositionTicks != null
                    ? `${Math.ceil(Math.max(0, episode.runtimeTicks - episode.playbackPositionTicks) / 600_000_000)}m left`
                    : `${progress}% watched`}
                </p>
              </div>
            )}
        </div>

        <div className="flex shrink-0 items-center">
          <Link
            href={`/watch/${encodeURIComponent(episode.id)}`}
            aria-label={`${progress !== null && progress > 0 && !episode.played ? "Resume" : "Watch"} ${episodeNumber(episode)} ${episode.title}`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-red-700 px-6 py-3 font-semibold text-white transition hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {progress !== null &&
            progress > 0 &&
            !episode.played
              ? "Resume Episode"
              : "Watch Episode"}
          </Link>
        </div>
      </div>
    </article>
  );
}

function SeriesDetails() {
  const parameters = useParams();

  const seriesId =
    typeof parameters.id === "string"
      ? parameters.id
      : "";

  const [selectedSeasonId, setSelectedSeasonId] =
    useState<string | null>(null);

  const [state, setState] =
    useState<SeriesState>({
      status: "loading",
    });

  const [refreshNumber, setRefreshNumber] =
    useState(0);

  useEffect(() => {
    if (!ID.test(seriesId)) return;

    const controller = new AbortController();

    async function load() {
      try {
        const query = new URLSearchParams({
          id: seriesId,
        });

        if (selectedSeasonId) {
          query.set(
            "seasonId",
            selectedSeasonId,
          );
        }

        const response = await fetch(
          `/api/series?${query.toString()}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) return;

        if (response.status === 401) {
          setState({ status: "login" });
          return;
        }

        if (!response.ok) {
          throw new Error(
            "TV series information unavailable.",
          );
        }

        const payload: unknown =
          await response.json();

        if (
          !isSeriesResponse(payload) ||
          payload.series.id.toLowerCase() !==
            seriesId.toLowerCase()
        ) {
          throw new Error(
            "Invalid TV series response.",
          );
        }

        if (
          !selectedSeasonId &&
          payload.seasons.length > 0
        ) {
          setSelectedSeasonId(
            payload.seasons[0].id,
          );
          return;
        }

        if (!controller.signal.aborted) {
          setState({
            status: "ready",
            data: payload,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message:
              "Unable to load this TV series.",
          });
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [seriesId, selectedSeasonId, refreshNumber]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setRefreshNumber((value) => value + 1);
      }
    };

    const interval = window.setInterval(
      refreshWhenVisible,
      60_000,
    );

    document.addEventListener(
      "visibilitychange",
      refreshWhenVisible,
    );

    return () => {
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        refreshWhenVisible,
      );
    };
  }, []);

  if (!ID.test(seriesId)) {
    return (
      <main className="min-h-screen bg-[#090909] p-8 text-white">
        <h1 className="text-2xl font-bold">
          Invalid TV series
        </h1>

        <Link
          href="/"
          className="mt-6 inline-block text-red-400 underline"
        >
          Return to PROMETHEUS
        </Link>
      </main>
    );
  }

  const episodes = state.status === "ready" ? state.data.episodes : [];
  const resumable = episodes.find((episode) =>
    !episode.played && (episode.playbackPositionTicks ?? 0) >= 300_000_000,
  );
  const primary = resumable ?? episodes.find((episode) => !episode.played) ?? episodes[0];
  const episodeNumber = primary?.episodeNumber;
  const seasonNumber = primary?.seasonNumber;
  const episodeLabel = episodeNumber == null
    ? primary?.title
    : `${seasonNumber == null ? "" : `S${seasonNumber} `}E${episodeNumber}`;

  return (
    <main className="prometheus-detail-page min-h-screen bg-[#090909] text-white">
      <PrometheusHeader />

      <div className="prometheus-detail-content mx-auto space-y-10">
        {state.status === "loading" && (
          <p role="status" className="text-neutral-400">
            Loading TV series...
          </p>
        )}

        {state.status === "login" && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold">
              Sign in required
            </h1>

            <Link
              href="/login"
              className="inline-flex rounded-lg bg-red-700 px-6 py-3 font-semibold text-white"
            >
              Sign In
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div className="space-y-4">
            <p role="alert" className="text-neutral-400">
              {state.message}
            </p>

            <Link
              href="/#series"
              className="text-red-400 underline"
            >
              Return to TV Series
            </Link>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <section className="prometheus-tv-detail" data-has-backdrop={Boolean(state.data.series.hasBackdrop)}
              style={state.data.series.hasBackdrop ? { backgroundImage:
                `linear-gradient(90deg, #080808f5 12%, #080808a0 47%, transparent), linear-gradient(0deg, #080808, transparent 45%), url("/api/artwork?id=${encodeURIComponent(state.data.series.id)}&type=Backdrop")` } : undefined}>
              <div className="prometheus-tv-detail-poster w-48 shrink-0">
                {state.data.series.hasPoster ? (
                  <Image
                    src={`/api/artwork?id=${encodeURIComponent(seriesId)}&type=Primary`}
                    alt={`${state.data.series.title} poster`}
                    width={400}
                    height={600}
                    unoptimized
                    className="w-full rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-neutral-800 p-4 text-center text-neutral-300">
                    {state.data.series.title}
                  </div>
                )}
              </div>

              <div className="prometheus-tv-detail-copy">
                <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-red-500">
                  PROMETHEUS TV Series
                </p>

                <h1 className="text-4xl font-bold md:text-5xl">
                  {state.data.series.title}
                </h1>

                {state.data.series.productionYear && (
                  <p className="mt-3 text-neutral-400">
                    {state.data.series.productionYear}
                  </p>
                )}

                {state.data.series.overview && (
                  <p className="mt-5 max-w-3xl leading-7 text-neutral-300">
                    {state.data.series.overview}
                  </p>
                )}
                {primary && (
                  <div className="prometheus-tv-detail-actions">
                    <PrimaryPlaybackLink id={primary.id} favouriteId={seriesId}
                      label={`${resumable ? "Resume" : "Play"} ${episodeLabel}`} />
                  </div>
                )}
              </div>
            </section>

            <section
              className="space-y-5"
              aria-label="Season selection"
            >
              <h2 className="text-2xl font-bold">
                Seasons
              </h2>

              {state.data.seasons.length > 0 ? (
                <div className="prometheus-season-rail">
                  {state.data.seasons.map((season) => (
                    <SeasonCard
                      key={season.id}
                      season={season}
                      seriesId={state.data.series.id}
                      seriesHasPoster={state.data.series.hasPoster}
                      selected={season.id === selectedSeasonId}
                      onSelect={() => setSelectedSeasonId(season.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-neutral-400">
                  No seasons are available.
                </p>
              )}
            </section>

            {selectedSeasonId && (
              <section className="prometheus-episodes-section space-y-5">
                <h2 className="text-2xl font-bold">
                  Episodes
                </h2>

                {state.data.selectedSeasonId !==
                selectedSeasonId ? (
                  <p
                    role="status"
                    className="text-neutral-400"
                  >
                    Loading episodes...
                  </p>
                ) : state.data.episodes.length > 0 ? (
                  <div className="space-y-4">
                    {state.data.episodes.map(
                      (episode) => (
                        <EpisodeCard
                          key={episode.id}
                          episode={episode}
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-neutral-400">
                    No episodes are available for this season.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function SeriesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#090909] p-8 text-neutral-400">
          Loading TV series...
        </main>
      }
    >
      <SeriesDetails />
    </Suspense>
  );
}
