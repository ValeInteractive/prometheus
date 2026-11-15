"use client";

import Link from "next/link";

import PrometheusVideo, { PlaybackInfo, type PlaybackFailure, type PlaybackTrack, type TrackChange } from "@/components/prometheus-video";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

const ITEM_ID_PATTERN = /^[a-f0-9]{32}$/i;

interface PlaybackSource {
  id: string | null;
  tracks: PlaybackTrack[];
  audioIndex: number | null;
  subtitleIndex: number;
  hlsUrl?: string | null;
  supportsDirectPlay: boolean;
  directPlayable: boolean;
  supportsDirectStream: boolean;
  supportsTranscoding: boolean;
}

interface EpisodeNavigation {
  seriesId?: string | null;
  nextEpisode?: { id: string; title: string } | null;
  credits?: { start: number; end: number }[];
}

interface PlaybackResponse {
  playSessionId?: string | null;
  item: EpisodeNavigation & {
    intros?: { start: number; end: number }[];
    id: string;
    type: string;
    episodeLabel?: string | null;
    title: string | null;
    runtimeTicks: number | null;
  };
  mediaSources: PlaybackSource[];
  playbackError: string | null;
}

type PlayerState =
  | { status: "loading" }
  | { status: "login" }
  | { status: "unavailable"; message: string }
  | (EpisodeNavigation & {
      status: "ready";
      title: string;
      itemType: string;
      episodeLabel?: string | null;
      intros?: { start: number; end: number }[];
      streamUrl: string;
      source: PlaybackSource;
      handoff?: { position: number; paused: boolean };
      mode: "direct" | "hls";
      mediaSourceId: string | null;
      playSessionId: string | null;
    });

function isPlaybackResponse(
  value: unknown,
): value is PlaybackResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Record<string, unknown>;

  if (
    !response.item ||
    typeof response.item !== "object" ||
    !Array.isArray(response.mediaSources)
  ) {
    return false;
  }

  const item = response.item as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    (
      item.type === "Movie" ||
      item.type === "Episode"
    )
  );
}

const SUBTITLE_PREFERENCE = "prometheus.subtitle-enabled";

function subtitlePreference(): boolean | null {
  try {
    const stored = localStorage.getItem(SUBTITLE_PREFERENCE);
    return stored === null ? null : stored === "true";
  } catch {
    return null;
  }
}

function rememberSubtitles(enabled: boolean) {
  try {
    localStorage.setItem(SUBTITLE_PREFERENCE, String(enabled));
  } catch {
    // Playback can continue when browser storage is unavailable.
  }
}

function englishTrack(source: PlaybackSource, kind: PlaybackTrack["kind"], current: number | null) {
  const matches = (source.tracks ?? []).filter((track) =>
    track.kind === kind && /^(en|eng|english)(?:[-_].+)?$/i.test(track.language ?? "") &&
    (kind === "Subtitle" || !track.commentary),
  );
  return matches.find((track) => track.index === current) ?? matches[0];
}

async function negotiateTracks(
  mediaId: string,
  sourceId: string,
  audio: number | null,
  subtitle: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ id: mediaId, source: sourceId });
  if (audio !== null) query.set("audio", String(audio));
  query.set("subtitle", String(subtitle));

  try {
    const response = await fetch(`/api/playback/negotiate?${query}`, { cache: "no-store", signal });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!isPlaybackResponse(data) || data.item.id.toLowerCase() !== mediaId.toLowerCase()) return null;
    const source = data.mediaSources.find((candidate) => candidate.id === sourceId);
    const streamUrl = source?.hlsUrl;
    if (!source || !streamUrl?.startsWith("/api/playback/hls?")) return null;
    return {
      mode: "hls" as const,
      streamUrl,
      source: { ...source, audioIndex: audio ?? source.audioIndex, subtitleIndex: subtitle },
      playSessionId: data.playSessionId ?? null,
    };
  } catch {
    return null;
  }
}

function WatchRoute() {
  const { id } = useParams();
  const mediaId = typeof id === "string" ? id : "";
  return <WatchPlayer key={mediaId} mediaId={mediaId} />;
}

function WatchPlayer({ mediaId }: { mediaId: string }) {
  const router = useRouter();

  const [state, setState] =
    useState<PlayerState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<PlaybackFailure | null>(null);
  const [showFailureInfo, setShowFailureInfo] = useState(false);
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (failure || state.status === "unavailable") retryRef.current?.focus();
  }, [failure, state.status]);

  function retry() {
    if (state.status === "ready" && failure) {
      const position = failure.position;
      setState({
        ...state,
        handoff: position === null ? state.handoff : { position, paused: false },
      });
    } else {
      setState({ status: "loading" });
      setAttempt((previous) => previous + 1);
    }
    setFailure(null);
    setShowFailureInfo(false);
  }

  useEffect(() => {
    if (!ITEM_ID_PATTERN.test(mediaId)) {
      return;
    }

    const controller = new AbortController();

    async function initialisePlayback() {
      try {
        const response = await fetch(
          `/api/playback/negotiate?id=${encodeURIComponent(mediaId)}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (response.status === 401) {
          setState({ status: "login" });
          return;
        }

        if (response.status === 404) {
          setState({
            status: "unavailable",
            message: "This video is not available.",
          });
          return;
        }

        if (!response.ok) {
          throw new Error("Playback negotiation failed.");
        }

        const data: unknown = await response.json();

        if (
          !isPlaybackResponse(data) ||
          data.item.id.toLowerCase() !== mediaId.toLowerCase()
        ) {
          throw new Error("Invalid playback information.");
        }

        const directSource = data.mediaSources.find(
          (source) => source.directPlayable === true,
        );

        const hlsSource = data.mediaSources.find(
          (source) =>
            typeof source.hlsUrl === "string" &&
            source.hlsUrl.startsWith(
              "/api/playback/hls?",
            ),
        );

        const initial = directSource ?? hlsSource;
        if (initial?.id) {
          const defaultSubtitle = directSource ? -1 : initial.subtitleIndex;
          const enabled = subtitlePreference() ?? defaultSubtitle >= 0;
          const audio = englishTrack(initial, "Audio", initial.audioIndex)?.index ?? initial.audioIndex;
          const subtitle = enabled
            ? englishTrack(initial, "Subtitle", defaultSubtitle)?.index ?? -1
            : -1;

          if (audio !== initial.audioIndex || subtitle !== defaultSubtitle) {
            const preferred = await negotiateTracks(mediaId, initial.id, audio, subtitle, controller.signal);
            if (controller.signal.aborted) return;
            if (preferred) {
              setState({
                status: "ready",
                title: data.item.title ?? "PROMETHEUS Video",
            itemType: data.item.type,
            episodeLabel: data.item.episodeLabel,
            intros: data.item.intros,
            credits: data.item.credits,
            seriesId: data.item.seriesId,
            nextEpisode: data.item.nextEpisode,
                mediaSourceId: initial.id,
                ...preferred,
              });
              return;
            }
          }
        }

        if (controller.signal.aborted) return;
        if (directSource) {
          setState({
            status: "ready",
            title: data.item.title ?? "PROMETHEUS Video",
            itemType: data.item.type,
            episodeLabel: data.item.episodeLabel,
            intros: data.item.intros,
            credits: data.item.credits,
            seriesId: data.item.seriesId,
            nextEpisode: data.item.nextEpisode,
            streamUrl:
              `/api/playback/stream?id=${encodeURIComponent(mediaId)}`,
            source: directSource,
            mode: "direct",
            mediaSourceId: directSource.id,
            playSessionId: data.playSessionId ?? null,
          });
          return;
        }

        if (hlsSource?.hlsUrl) {
          setState({
            status: "ready",
            title: data.item.title ?? "PROMETHEUS Video",
            itemType: data.item.type,
            episodeLabel: data.item.episodeLabel,
            intros: data.item.intros,
            credits: data.item.credits,
            seriesId: data.item.seriesId,
            nextEpisode: data.item.nextEpisode,
            streamUrl: hlsSource.hlsUrl,
            source: hlsSource,
            mode: "hls",
            mediaSourceId: hlsSource.id,
            playSessionId: data.playSessionId ?? null,
          });
          return;
        }

        setState({
          status: "unavailable",
          message:
            "This video has no supported playback source.",
        });
      } catch {
        if (!controller.signal.aborted) {
          setState({
            status: "unavailable",
            message:
              "PROMETHEUS could not prepare this video.",
          });
        }
      }
    }

    void initialisePlayback();

    return () => controller.abort();
  }, [mediaId, attempt]);

  async function switchTrack(change: TrackChange) {
    if (state.status !== "ready" || !state.mediaSourceId || failure) return false;
    const currentSubtitle = state.mode === "direct" ? -1 : state.source.subtitleIndex;
    if (change.audio === state.source.audioIndex && change.subtitle === currentSubtitle) {
      if (change.rememberSubtitle) rememberSubtitles(change.subtitle >= 0);
      return true;
    }
    const next = await negotiateTracks(mediaId, state.mediaSourceId, change.audio, change.subtitle);
    if (!next) return false;
    const handoff = change.capture();
    if (change.rememberSubtitle) rememberSubtitles(change.subtitle >= 0);
    setState((current) => current === state ? { ...state, ...next, handoff } : current);
    return true;
  }

  if (!ITEM_ID_PATTERN.test(mediaId)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#090909] p-6 text-white">
        <h1 className="text-2xl font-semibold">
          Invalid video
        </h1>

        <Link href="/" className="text-red-400 underline">
          Return to PROMETHEUS
        </Link>
      </main>
    );
  }

  return (
    <main className="prometheus-watch-screen">
      {!isPlaying && (
        <header className="prometheus-watch-header">
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            ← Back to PROMETHEUS
          </Link>

          <span className="prometheus-watch-title">
            {state.status === "ready" ? state.title : "PROMETHEUS"}
          </span>
        </header>
      )}

      <section className="prometheus-watch-stage">
        {state.status === "loading" && (
          <p role="status" className="text-neutral-400">
            Preparing your video...
          </p>
        )}

        {state.status === "login" && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold">
              Sign in required
            </h1>

            <p className="text-neutral-400">
              Sign in to watch your personal media.
            </p>

            <Link
              href="/login"
              className="inline-block rounded-md bg-red-700 px-5 py-3 font-semibold text-white"
            >
              Sign In
            </Link>
          </div>
        )}

        {(state.status === "unavailable" || failure) && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold">
              Video unavailable
            </h1>

            <p role="alert" className="text-neutral-400">
              {failure
                ? failure.stalled
                  ? "Playback stalled while buffering. Retry to continue from the last available position."
                  : "The video could not be played. Retry to reconnect to the stream."
                : state.status === "unavailable" ? state.message : ""}
            </p>
            {showFailureInfo && failure && state.status === "ready" && (
              <PlaybackInfo mode={state.mode} width={failure.width} height={failure.height}
                tracks={state.source.tracks ?? []} audioIndex={state.source.audioIndex}
                subtitleIndex={state.mode === "direct" ? -1 : state.source.subtitleIndex} />
            )}
            <div className="flex justify-center gap-4">
              <button ref={retryRef} type="button" onClick={retry}
                className="rounded bg-red-700 px-4 py-2 focus:outline-2 focus:outline-offset-4">
                Retry
              </button>
              {failure && state.status === "ready" && (
                <button type="button" aria-expanded={showFailureInfo}
                  onClick={() => setShowFailureInfo((open) => !open)}
                  className="rounded bg-neutral-800 px-4 py-2 focus:outline-2 focus:outline-offset-4">
                  {showFailureInfo ? "Hide Playback Info" : "Playback Info"}
                </button>
              )}
              <Link href={state.status === "ready" && state.itemType === "Movie"
                ? `/movie/${encodeURIComponent(mediaId)}` : "/"}
                className="rounded bg-neutral-800 px-4 py-2 focus:outline-2 focus:outline-offset-4">
                {state.status === "ready" && state.itemType === "Movie" ? "Back to title" : "Home"}
              </Link>
            </div>
          </div>
        )}

        {state.status === "ready" && !failure && (
          <>
            <PrometheusVideo
              key={`${attempt}:${state.streamUrl}`}
              title={state.title}
              episodeLabel={state.episodeLabel}
              mediaId={mediaId}
              mediaSourceId={state.mediaSourceId}
              playSessionId={state.playSessionId}
              src={state.streamUrl}
              tracks={state.source.tracks ?? []}
              audioIndex={state.source.audioIndex}
              subtitleIndex={state.mode === "direct" ? -1 : state.source.subtitleIndex}
              handoff={state.handoff}
              intros={state.intros}
              nextEpisode={state.nextEpisode}
              seriesId={state.seriesId}
              onNextEpisode={(id) => router.replace(`/watch/${encodeURIComponent(id)}`)}
              onBackToSeries={(id) => router.push(`/series/${encodeURIComponent(id)}`)}
              onTrackChange={switchTrack}
              mode={state.mode}
              onPlaybackChange={setIsPlaying}
              onError={(problem) => {
                setIsPlaying(false);
                setFailure(problem);
              }}
            />

          </>
        )}
      </section>
    </main>
  );
}


export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#090909] text-white">
          <p
            role="status"
            className="text-sm text-neutral-400"
          >
            Preparing PROMETHEUS player...
          </p>
        </main>
      }
    >
      <WatchRoute />
    </Suspense>
  );
}
