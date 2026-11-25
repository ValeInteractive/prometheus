"use client";

import type { KeyboardEvent } from "react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

interface TrickplayProfile {
  width: number;
  height: number;
  columns: number;
  rows: number;
  interval: number;
  count: number;
}

type PlaybackMode = "direct" | "hls";

const pendingStops = new Map<string, Promise<void>>();

export interface PlaybackTrack {
  kind: "Audio" | "Subtitle";
  index: number;
  label: string;
  language?: string | null;
  commentary?: boolean;
}

export interface PlaybackFailure {
  position: number | null;
  stalled: boolean;
  width: number;
  height: number;
}

export function PlaybackInfo({ mode, width, height, tracks, audioIndex, subtitleIndex }: {
  mode: PlaybackMode;
  width: number;
  height: number;
  tracks: PlaybackTrack[];
  audioIndex: number | null;
  subtitleIndex: number;
}) {
  const audio = tracks.find((track) => track.kind === "Audio" && track.index === audioIndex);
  const subtitle = tracks.find((track) => track.kind === "Subtitle" && track.index === subtitleIndex);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt>Playback</dt><dd>{mode === "direct" ? "Direct Play" : "Transcoding (HLS)"}</dd>
      <dt>Resolution</dt><dd>{width && height ? `${width} × ${height}` : "Unavailable"}</dd>
      <dt>Audio</dt><dd>{audio?.label ?? "Stream default"}</dd>
      <dt>Subtitles</dt><dd>{subtitleIndex === -1 ? "Off" : subtitle?.label ?? "Unavailable"}</dd>
    </dl>
  );
}

export interface TrackChange {
  audio: number | null;
  subtitle: number;
  rememberSubtitle: boolean;
  capture: () => { position: number; paused: boolean };
}

interface PrometheusVideoProps {
  episodeLabel?: string | null;
  intros?: { start: number; end: number }[];
  nextEpisode?: { id: string; title: string } | null;
  seriesId?: string | null;
  onNextEpisode: (id: string) => void;
  onBackToSeries: (id: string) => void;
  tracks: PlaybackTrack[];
  audioIndex: number | null;
  subtitleIndex: number;
  handoff?: { position: number; paused: boolean };
  onTrackChange: (change: TrackChange) => Promise<boolean>;
  title: string;
  mediaId: string;
  mediaSourceId: string | null;
  playSessionId: string | null;
  src: string;
  mode: PlaybackMode;
  onError: (failure: PlaybackFailure) => void;
  onPlaybackChange: (playing: boolean) => void;
}

export default function PrometheusVideo({
  title, episodeLabel,
  intros, nextEpisode, seriesId, onNextEpisode, onBackToSeries,
  tracks, audioIndex, subtitleIndex, handoff, onTrackChange,
  mediaId,
  mediaSourceId,
  playSessionId,
  src,
  mode,
  onError,
  onPlaybackChange,
}: PrometheusVideoProps) {
  const [episodeEnded, setEpisodeEnded] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const [autoplay, setAutoplay] = useState(() => {
    try {
      return localStorage.getItem("prometheus.autoplay-next") === "true";
    } catch {
      return false;
    }
  });
  const [countdown, setCountdown] = useState(8);
  const nextRef = useRef<HTMLDivElement>(null);
  const nextStarted = useRef(false);
  const [infoMenu, setInfoMenu] = useState(false);
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  const [accessibilityMenu, setAccessibilityMenu] = useState(false);
  const [accessibility, setAccessibility] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("prometheus.player-accessibility") ?? "{}");
      return {
        largeText: saved?.largeText === true,
        strongFocus: saved?.strongFocus === true,
        reducedMotion: saved?.reducedMotion === true,
      };
    } catch {
      return { largeText: false, strongFocus: false, reducedMotion: false };
    }
  });

  function toggleAccessibility(setting: keyof typeof accessibility) {
    const next = { ...accessibility, [setting]: !accessibility[setting] };
    setAccessibility(next);
    try {
      localStorage.setItem("prometheus.player-accessibility", JSON.stringify(next));
    } catch {
      // Keep the setting for the current player when storage is unavailable.
    }
  }

  const [trackMenu, setTrackMenu] = useState(false);
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackError, setTrackError] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const horizontalPress = useRef<{ key: string; repeats: number } | null>(null);
  const scrubTarget = useRef<number | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopProgressRef = useRef<(() => void) | null>(null);
  const errorRef = useRef(onError);
  const confirmedPosition = useRef<number | null>(handoff?.position ?? null);
  const playbackFailed = useRef(false);

  function reportFailure(stalled: boolean) {
    if (playbackFailed.current) return;
    playbackFailed.current = true;
    errorRef.current({
      position: confirmedPosition.current,
      stalled,
      width: videoRef.current?.videoWidth ?? 0,
      height: videoRef.current?.videoHeight ?? 0,
    });
  }

  const [hlsReady, setHlsReady] = useState(false);
  const [resumeReady, setResumeReady] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const [trickplay, setTrickplay] = useState<TrickplayProfile | null>(null);
  const [loadedTile, setLoadedTile] = useState<string | null>(null);
  const previewQuery = new URLSearchParams({
    id: mediaId,
    type: "Trickplay",
    source: mediaSourceId ?? mediaId,
  }).toString();
  const isScrubbing = previewTime !== null;

  useEffect(() => {
    if (!isScrubbing) return;
    const controller = new AbortController();
    void fetch(`/api/artwork?${previewQuery}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => {
        if (!controller.signal.aborted) setTrickplay(profile);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isScrubbing, previewQuery]);

  const frame = trickplay && previewTime !== null
    ? Math.min(trickplay.count - 1, Math.floor(previewTime * 1000 / trickplay.interval))
    : 0;
  const framesPerTile = trickplay ? trickplay.columns * trickplay.rows : 1;
  const tileUrl = trickplay && isScrubbing
    ? `/api/artwork?${previewQuery}&width=${trickplay.width}&tile=${Math.floor(frame / framesPerTile)}`
    : null;

  useEffect(() => {
    if (!tileUrl) return;
    const image = new Image();
    image.onload = () => setLoadedTile(tileUrl);
    image.src = tileUrl;
    return () => { image.onload = null; };
  }, [tileUrl]);

  const preparing = mode === "hls" && !hlsReady;

  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resumeReady || (mode === "hls" && !hlsReady)) return;

    video.focus({ preventScroll: true });
    if (handoff?.paused) return;
    void video.play().then(
      () => setAutoplayBlocked(false),
      () => setAutoplayBlocked(true),
    );
  }, [handoff, hlsReady, mode, resumeReady, src]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;
    const media = video;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    function clearStall() {
      if (stallTimer !== null) clearTimeout(stallTimer);
      stallTimer = null;
    }

    function watchForStall() {
      if (media.paused || media.ended || stallTimer !== null) return;
      stallTimer = setTimeout(() => {
        stallTimer = null;
        if (!media.paused && !media.ended && !playbackFailed.current && !(engine && seeking)) {
          reportFailure(true);
        }
      }, 15000);
    }

    function confirmProgress() {
      if (!media.seeking && media.readyState >= 2 && Number.isFinite(media.currentTime)) {
        confirmedPosition.current = media.currentTime;
        clearStall();
      }
    }

    media.addEventListener("waiting", watchForStall);
    media.addEventListener("seeking", watchForStall);
    media.addEventListener("timeupdate", confirmProgress);
    media.addEventListener("seeked", confirmProgress);
    media.addEventListener("playing", confirmProgress);
    media.addEventListener("pause", clearStall);
    media.addEventListener("ended", clearStall);

    function removeStallListeners() {
      clearStall();
      media.removeEventListener("waiting", watchForStall);
      media.removeEventListener("seeking", watchForStall);
      media.removeEventListener("timeupdate", confirmProgress);
      media.removeEventListener("seeked", confirmProgress);
      media.removeEventListener("playing", confirmProgress);
      media.removeEventListener("pause", clearStall);
      media.removeEventListener("ended", clearStall);
    }

    let cancelled = false;
    let engine: import("hls.js").default | null = null;
    let recoveryAttempts = 0;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let seekWatchdog: ReturnType<typeof setTimeout> | null = null;
    let seeking = false;

    const MAX_RECOVERY_ATTEMPTS = 3;
    const SEEK_TIMEOUT_MS = 12000;

    function clearRecoveryTimer() {
      if (recoveryTimer !== null) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
    }

    function clearSeekWatchdog() {
      if (seekWatchdog !== null) {
        clearTimeout(seekWatchdog);
        seekWatchdog = null;
      }
    }

    function failPlayback() {
      if (!cancelled) {
        clearRecoveryTimer();
        clearSeekWatchdog();
        reportFailure(false);
      }
    }

    function recoverPlayback(
      kind: "network" | "media",
    ) {
      if (cancelled || !engine) return;

      if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
        failPlayback();
        return;
      }

      recoveryAttempts += 1;

      clearRecoveryTimer();

      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;

        if (cancelled || !engine) return;

        if (kind === "media") {
          engine.recoverMediaError();
        } else {
          engine.startLoad(seeking ? media.currentTime : -1);
        }
      }, recoveryAttempts * 1000);
    }

    function scheduleSeekWatchdog() {
      clearSeekWatchdog();

      seekWatchdog = setTimeout(() => {
        seekWatchdog = null;

        if (cancelled || !seeking) return;

        if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          failPlayback();
          return;
        }

        recoverPlayback("network");

        scheduleSeekWatchdog();
      }, SEEK_TIMEOUT_MS);
    }

    function onSeeking() {
      if (cancelled || !engine) return;

      seeking = true;
      recoveryAttempts = 0;
      clearRecoveryTimer();

      scheduleSeekWatchdog();
    }

    function onPlaying() {
      seeking = false;
      recoveryAttempts = 0;
      clearRecoveryTimer();
      clearSeekWatchdog();
    }

    video.addEventListener("seeking", onSeeking);
    video.addEventListener("playing", onPlaying);

    if (mode === "direct") {
      video.src = src;
      return () => {
        removeStallListeners();
        video.removeEventListener("seeking", onSeeking);
        video.removeEventListener("playing", onPlaying);
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    async function setupHls() {
      try {
        const { default: Hls } = await import("hls.js");

        if (cancelled || !video) return;

        if (Hls.isSupported()) {
          const instance = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
          });

          engine = instance;

          instance.on(
            Hls.Events.MANIFEST_PARSED,
            () => {
              if (!cancelled) setHlsReady(true);
            },
          );

          instance.on(
            Hls.Events.ERROR,
            (_event, details) => {
              if (cancelled || !details.fatal) return;

              if (details.type === Hls.ErrorTypes.NETWORK_ERROR) {
                recoverPlayback("network");
                return;
              }

              if (details.type === Hls.ErrorTypes.MEDIA_ERROR) {
                recoverPlayback("media");
                return;
              }

              failPlayback();
            },
          );

          instance.loadSource(src);
          instance.attachMedia(video);

          return;
        }

        if (
          video.canPlayType(
            "application/vnd.apple.mpegurl",
          )
        ) {
          video.src = src;
          setHlsReady(true);
          return;
        }

        reportFailure(false);
      } catch {
        failPlayback();
      }
    }

    void setupHls();

    return () => {
      cancelled = true;
      stopProgressRef.current?.();

      clearRecoveryTimer();
      clearSeekWatchdog();

      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("playing", onPlaying);

      removeStallListeners();
      engine?.destroy();

      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [mode, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const controller = new AbortController();

    let active = true;
    let started = false;
    let stopped = false;
    let resumeResolved = false;
    let resume: number | null = null;
    let reports = Promise.resolve();

    function report(
      event: "start" | "progress" | "stop",
      keepalive = false,
    ) {
      if (!started) return;

      const seconds = Number.isFinite(video!.currentTime)
        ? Math.max(0, video!.currentTime)
        : 0;

      const payload = JSON.stringify({
        id: mediaId,
        mediaSourceId,
        playSessionId,
        event,
        positionSeconds: seconds,
        mode,
        paused: video!.paused,
      });

      reports = reports.then(async () => {
        const response = await fetch("/api/playback/progress", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        keepalive,
        headers: {
          "Content-Type": "application/json",
        },
          body: payload,
        });
        if (response.ok && event === "stop") {
          window.dispatchEvent(new Event("prometheus:title-changed"));
        }
      }).catch(() => {
        // Progress failures must not interrupt playback.
      });
    }

    function applyResume() {
      if (
        !active ||
        started ||
        resume === null ||
        video!.currentTime > 2 ||
        video!.readyState < 1 ||
        video!.seekable.length === 0
      ) {
        return;
      }

      const duration = video!.duration;

      const target = Number.isFinite(duration)
        ? Math.min(resume, duration)
        : resume;

      if (!handoff && target <= 0) {
        resume = null;
        return;
      }

      try {
        video!.currentTime = target;
        resume = null;
      } catch {
        // Retry after metadata or seekable ranges update.
      }
    }

    async function loadResume() {
      if (handoff) {
        resume = handoff.position;
        resumeResolved = true;
        applyResume();
        setResumeReady(true);
        return;
      }
      try {
        await pendingStops.get(mediaId);
        if (!active) return;

        const response = await fetch(
          `/api/playback/info?id=${encodeURIComponent(mediaId)}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok || !active) return;

        const data: unknown = await response.json();

        if (!data || typeof data !== "object") return;

        const result = data as Record<string, unknown>;
        const item =
          result.item && typeof result.item === "object"
            ? result.item as Record<string, unknown>
            : null;

        const ticks = item?.resumePositionTicks;

        if (
          !active ||
          started ||
          typeof ticks !== "number" ||
          !Number.isFinite(ticks) ||
          ticks < 0
        ) {
          return;
        }

        resume = ticks / 10_000_000;
        applyResume();
      } catch {
        // Resume data is optional.
      } finally {
        if (active) {
          resumeResolved = true;
          applyResume();
          setResumeReady(true);
        }
      }
    }

    function playing() {
      if (!active || stopped) return;

      if (!resumeResolved) {
        video!.pause();
        return;
      }

      if (resume !== null) {
        applyResume();

        if (resume !== null) {
          video!.pause();
          return;
        }
      }

      if (!started) {
        started = true;
        report("start");
      } else {
        report("progress");
      }
    }

    function progress() {
      if (active && started && !stopped) {
        report("progress");
      }
    }

    function end() {
      if (started && !stopped) {
        stopped = true;
        report("stop", true);
        const saved = reports;
        pendingStops.set(mediaId, saved);
        void saved.then(() => {
          if (pendingStops.get(mediaId) === saved) pendingStops.delete(mediaId);
        });
      }
    }

    stopProgressRef.current = end;
    video.addEventListener("playing", playing);
    video.addEventListener("pause", progress);
    video.addEventListener("seeked", progress);
    video.addEventListener("ended", end);

    video.addEventListener("loadedmetadata", applyResume);
    video.addEventListener("durationchange", applyResume);
    video.addEventListener("canplay", applyResume);

    window.addEventListener("pagehide", end);

    const timer = window.setInterval(() => {
      if (
        active &&
        started &&
        !stopped &&
        !video.paused &&
        !video.ended
      ) {
        report("progress");
      }
    }, 5000);

    void loadResume();

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);

      video.removeEventListener("playing", playing);
      video.removeEventListener("pause", progress);
      video.removeEventListener("seeked", progress);
      video.removeEventListener("ended", end);

      video.removeEventListener("loadedmetadata", applyResume);
      video.removeEventListener("durationchange", applyResume);
      video.removeEventListener("canplay", applyResume);

      window.removeEventListener("pagehide", end);

      end();
      if (stopProgressRef.current === end) stopProgressRef.current = null;
    };
  }, [
    src,
    mediaId,
    mediaSourceId,
    playSessionId,
    mode,
    handoff,
  ]);

  useEffect(() => () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
  }, []);

  function hideControls() {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    setControlsOpen(false);
    videoRef.current?.focus({ preventScroll: true });
  }

  const remainingSeconds = time.duration - time.position;
  const nearEpisodeEnd = time.duration > 0 && remainingSeconds <= 30;
  const showNext = Boolean(nextEpisode && !nextDismissed &&
    (episodeEnded || nextOpen || (nearEpisodeEnd && !trackMenu &&
      !accessibilityMenu && !infoMenu && previewTime === null)));
  const shouldCountDown = showNext && autoplay && episodeEnded;

  useEffect(() => {
    if (!showNext) {
      return;
    }
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    const prompt = nextRef.current;
    const video = videoRef.current;
    prompt?.querySelector("button")?.focus();
    return () => {
      if (document.activeElement === document.body || prompt?.contains(document.activeElement)) {
        video?.focus({ preventScroll: true });
      }
    };
  }, [showNext]);

  useEffect(() => {
    if (!shouldCountDown) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") setCountdown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    // Keep checking after a background tick without advancing the countdown.
    const visibility = () => {
      if (document.visibilityState === "visible") setCountdown(8);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [shouldCountDown, countdown]);

  useEffect(() => {
    if (shouldCountDown && countdown === 0 && document.visibilityState === "visible" && nextEpisode && !nextStarted.current) {
      nextStarted.current = true;
      onNextEpisode(nextEpisode.id);
    }
  }, [shouldCountDown, countdown, nextEpisode, onNextEpisode]);

  function dismissNext() {
    setNextOpen(false);
    setNextDismissed(true);
    hideControls();
  }

  function toggleAutoplay() {
    const enabled = !autoplay;
    setAutoplay(enabled);
    setCountdown(8);
    try {
      localStorage.setItem("prometheus.autoplay-next", String(enabled));
    } catch {
      // This player can still use the setting for the current episode.
    }
  }

  const activeIntro = intros?.find((intro) =>
    time.position >= intro.start && time.position < intro.end &&
    time.duration > 0 && intro.end < time.duration,
  );
  const showSkipIntro = resumeReady && activeIntro && previewTime === null;

  const menuOpen = trackMenu || accessibilityMenu || infoMenu;

  function keepControlsVisible() {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    if (!menuOpen && !videoRef.current?.paused) {
      hideTimer.current = setTimeout(hideControls, 5000);
    }
  }

  useEffect(() => {
    if (controlsOpen) controlsRef.current?.querySelector("button")?.focus();
  }, [controlsOpen, trackMenu, accessibilityMenu, infoMenu]);

  function closeTrackMenu() {
    setTrackMenu(false);
    setAccessibilityMenu(false);
    setInfoMenu(false);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    if (!videoRef.current?.paused) hideTimer.current = setTimeout(hideControls, 5000);
  }

  async function selectTrack(audio: number | null, subtitle: number, rememberSubtitle = false) {
    const video = videoRef.current;
    if (!video || trackBusy) return;
    if (!rememberSubtitle && audio === audioIndex && subtitle === subtitleIndex) {
      closeTrackMenu();
      return;
    }
    setTrackBusy(true);
    setTrackError(false);
    const changed = await onTrackChange({
      audio,
      subtitle,
      rememberSubtitle,
      capture: () => ({ position: video.currentTime, paused: video.paused }),
    });
    setTrackBusy(false);
    if (!changed) setTrackError(true);
    else closeTrackMenu();
  }

  function togglePlayback(video: HTMLVideoElement) {
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }

  function updateTime(video: HTMLVideoElement) {
    setTime({
      position: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    });
  }

  function formatTime(seconds: number) {
    const whole = Math.floor(seconds);
    const minutes = Math.floor(whole / 60);
    return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
  }

  function clampSeek(video: HTMLVideoElement, position: number) {
    const ranges = video.seekable;
    if (!Number.isFinite(position)) return null;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      return Math.max(0, Math.min(video.duration, position));
    }
    if (ranges.length === 0) return null;
    let nearest = ranges.start(0);
    for (let index = 0; index < ranges.length; index++) {
      const start = ranges.start(index);
      const end = ranges.end(index);
      const candidate = Math.max(start, Math.min(end, position));
      if (Math.abs(candidate - position) < Math.abs(nearest - position)) {
        nearest = candidate;
      }
    }
    return nearest;
  }

  function seek(video: HTMLVideoElement, position: number) {
    const target = clampSeek(video, position);
    if (target === null) return;
    // Seeking to the exact duration can leave no frame to decode.
    const lastPlayableSecond = Number.isFinite(video.duration)
      ? Math.max(0, video.duration - 1)
      : target;
    video.currentTime = Math.min(target, lastPlayableSecond);
  }

  function finishScrub(video: HTMLVideoElement, commit: boolean) {
    const target = scrubTarget.current;
    scrubTarget.current = null;
    horizontalPress.current = null;
    setPreviewTime(null);
    if (commit && target !== null) seek(video, target);
  }

  function handleRemoteKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    const press = horizontalPress.current;
    const video = videoRef.current;
    if (!video || press?.key !== event.key) return;

    horizontalPress.current = null;
    event.preventDefault();
    if (press.repeats === 0 && scrubTarget.current === null) {
      seek(video, video.currentTime + (press.key === "ArrowRight" ? 10 : -10));
    }
  }

  function handleRemoteKey(event: KeyboardEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !resumeReady || event.altKey || event.ctrlKey || event.metaKey) return;

    const { key } = event;
    if (showNext) {
      if (key === "Escape" || key === "BrowserBack") {
        event.preventDefault();
        dismissNext();
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
        event.preventDefault();
        const buttons = Array.from(nextRef.current?.querySelectorAll("button") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const offset = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
        buttons[Math.max(0, index + offset)]?.focus();
        return;
      }
      if (key === "Enter" && event.target === video) {
        event.preventDefault();
        nextRef.current?.querySelector("button")?.focus();
        return;
      }
    }

    if (controlsOpen) keepControlsVisible();

    if (event.target instanceof HTMLInputElement &&
        event.target.type === "range" &&
        (key === "ArrowLeft" || key === "ArrowRight" || key === "Enter")) {
      event.preventDefault();
      if (key === "Enter") {
        controlsRef.current?.querySelector("button")?.focus();
      } else {
        seek(video, video.currentTime + (key === "ArrowRight" ? 10 : -10));
        updateTime(video);
      }
      return;
    }

    if (controlsOpen && !menuOpen && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      const selector = key === "ArrowUp" ? 'input[type="range"]' : "button";
      controlsRef.current?.querySelector<HTMLElement>(selector)?.focus();
      return;
    }

    if (scrubTarget.current !== null &&
        (key === "Enter" || key === "Escape" || key === "BrowserBack")) {
      event.preventDefault();
      if (!event.repeat) finishScrub(video, key === "Enter");
      return;
    }

    if ((key === "Escape" || key === "BrowserBack") && controlsOpen) {
      event.preventDefault();
      if (menuOpen) closeTrackMenu();
      else hideControls();
      return;
    }

    if (key === "MediaPlayPause" || key === "MediaPlay" || key === "MediaPause") {
      event.preventDefault();
      if (event.repeat) return;
      if (key === "MediaPause") video.pause();
      else if (key === "MediaPlay") void video.play().catch(() => {});
      else togglePlayback(video);
      return;
    }

    if (menuOpen && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
      event.preventDefault();
      const buttons = Array.from(controlsRef.current?.querySelectorAll("button") ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const offset = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
      buttons[index + offset]?.focus();
      return;
    }

    if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const direction = key === "ArrowRight" ? 1 : -1;
      if (controlsOpen) {
        const buttons = Array.from(controlsRef.current?.querySelectorAll("button") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[index + direction]?.focus();
      } else if (!event.repeat) {
        // Older Fire TV builds send keydown only.
        if (!event.nativeEvent.isTrusted && event.code === "") {
          seek(video, video.currentTime + direction * 10);
        } else {
          horizontalPress.current = { key, repeats: 0 };
          if (scrubTarget.current !== null) {
            const target = clampSeek(video, scrubTarget.current + direction * 10);
            scrubTarget.current = target;
            setPreviewTime(target);
          }
        }
      } else {
        const press = horizontalPress.current;
        if (press?.key !== key) return;
        press.repeats++;
        const step = press.repeats < 8 ? 15 : 30;
        const target = clampSeek(video, (scrubTarget.current ?? video.currentTime) + direction * step);
        scrubTarget.current = target;
        setPreviewTime(target);
      }
      return;
    }

    if (scrubTarget.current !== null) return;
    if (event.repeat && key === "Enter") {
      event.preventDefault();
      return;
    }
    horizontalPress.current = null;

    if (!controlsOpen && key === "Enter" && showSkipIntro) {
      event.preventDefault();
      seek(video, activeIntro.end);
      return;
    }

    if (!controlsOpen && (key === "Enter" || key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      setControlsOpen(true);
      keepControlsVisible();
    } else if (key === " " && event.target === video) {
      event.preventDefault();
      togglePlayback(video);
    } else if (key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFullscreen();
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void videoRef.current?.parentElement?.requestFullscreen?.().catch(() => {});
  }

  return (
    <div
      className="prometheus-video-shell"
      data-large-text={accessibility.largeText}
      data-strong-focus={accessibility.strongFocus}
      data-reduced-motion={accessibility.reducedMotion}
      onKeyDown={handleRemoteKey}
      onKeyUp={handleRemoteKeyUp}
    >
      {!resumeReady && (
        <p
          role="status"
          className="prometheus-player-status"
        >
          Checking saved playback position...
        </p>
      )}

      {preparing && (
        <p
          role="status"
          className="prometheus-player-status"
        >
          Preparing HLS playback...
        </p>
      )}

      {autoplayBlocked && (
        <p className="prometheus-player-status" role="status">
          Press Play to start this video.
        </p>
      )}

      <video
        ref={videoRef}
        tabIndex={0}
        onClick={() => {
          if (!resumeReady || scrubTarget.current !== null) return;
          horizontalPress.current = null;
          setControlsOpen(true);
          keepControlsVisible();
        }}
        onTimeUpdate={(event) => updateTime(event.currentTarget)}
        onDurationChange={(event) => updateTime(event.currentTarget)}
        onPlay={() => onPlaybackChange(true)}
        onPlaying={() => {
          setAutoplayBlocked(false);
          setPaused(false);
          if (controlsOpen) keepControlsVisible();
          onPlaybackChange(true);
        }}
        onPause={() => {
          setPaused(true);
          if (hideTimer.current !== null) clearTimeout(hideTimer.current);
          onPlaybackChange(false);
        }}
        onEnded={() => {
          setEpisodeEnded(true);
          setPaused(true);
          onPlaybackChange(false);
        }}
        autoPlay={!handoff?.paused}
        playsInline
        preload="metadata"
        className="prometheus-video-element"
        aria-label={`${title} video player`}
        onError={() => {
          onPlaybackChange(false);
          reportFailure(false);
        }}
      >
        Your browser does not support HTML5 video.
      </video>

      {previewTime !== null && (
        <div className="prometheus-playback-controls">
          {trickplay && tileUrl && loadedTile === tileUrl && (
            <div
              role="img"
              aria-label="Preview at seek position"
              style={{
                width: trickplay.width,
                height: trickplay.height,
                backgroundImage: `url("${tileUrl}")`,
                backgroundPosition: `-${(frame % trickplay.columns) * trickplay.width}px -${Math.floor((frame % framesPerTile) / trickplay.columns) * trickplay.height}px`,
              }}
            />
          )}
          <p>Jump to {formatTime(previewTime)}</p>
          <div className="prometheus-playback-timeline">
            <progress aria-label="Seek preview" value={previewTime} max={time.duration || 1} />
          </div>
          <p>Select to jump · Back to cancel</p>
        </div>
      )}

      {showSkipIntro && !controlsOpen && (
        <div className="prometheus-playback-controls">
          <button type="button" onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.focus({ preventScroll: true });
            seek(video, activeIntro.end);
          }}>Skip Intro</button>
        </div>
      )}

      {showNext && nextEpisode && (
        <div ref={nextRef} className="prometheus-playback-controls" role="group" aria-label="Next Episode">
          <p>Next Episode · {nextEpisode.title}</p>
          {shouldCountDown && <p>Playing in {countdown}s</p>}
          <button type="button" onClick={() => {
            if (nextStarted.current) return;
            nextStarted.current = true;
            onNextEpisode(nextEpisode.id);
          }}>Play Now</button>
          <button type="button" onClick={dismissNext}>Cancel</button>
          {seriesId && <button type="button" onClick={() => onBackToSeries(seriesId)}>Back to series</button>}
          <button type="button" aria-pressed={autoplay} onClick={toggleAutoplay}>
            Autoplay: {autoplay ? "On" : "Off"}
          </button>
        </div>
      )}

      {controlsOpen && !showNext && (
        <div ref={controlsRef} className="prometheus-playback-controls prometheus-tv-player-controls" aria-label="Playback controls" role="group">
          {infoMenu ? (
            <div className="prometheus-accessibility-menu" role="group" aria-label="Playback Info">
              <button type="button" onClick={closeTrackMenu}>Back to controls</button>
              <PlaybackInfo mode={mode} {...resolution} tracks={tracks} audioIndex={audioIndex} subtitleIndex={subtitleIndex} />
            </div>
          ) : accessibilityMenu ? (
            <div className="prometheus-accessibility-menu" aria-label="Player accessibility" role="group">
              <button type="button" onClick={closeTrackMenu}>Back to controls</button>
              <button type="button" aria-pressed={accessibility.largeText} onClick={() => toggleAccessibility("largeText")}>
                Larger text: {accessibility.largeText ? "On" : "Off"}
              </button>
              <button type="button" aria-pressed={accessibility.strongFocus} onClick={() => toggleAccessibility("strongFocus")}>
                Stronger focus outline: {accessibility.strongFocus ? "On" : "Off"}
              </button>
              <button type="button" aria-pressed={accessibility.reducedMotion} onClick={() => toggleAccessibility("reducedMotion")}>
                Reduced motion: {accessibility.reducedMotion ? "On" : "Off"}
              </button>
            </div>
          ) : trackMenu ? (
            <div className="prometheus-track-menu" style={{ maxHeight: "50vh", overflowY: "auto" }} aria-label="Audio and subtitles" role="group" aria-busy={trackBusy}>
              <button type="button" onClick={closeTrackMenu}>Back to controls</button>
              <p>Audio</p>
              {tracks.filter((track) => track.kind === "Audio").map((track) => (
                <button key={track.index} type="button" className="block" aria-pressed={track.index === audioIndex}
                  onClick={() => void selectTrack(track.index, subtitleIndex)}>
                  {track.label}{track.index === audioIndex ? " ✓" : ""}
                </button>
              ))}
              <p>Subtitles</p>
              <button type="button" className="block" aria-pressed={subtitleIndex === -1}
                onClick={() => void selectTrack(audioIndex, -1, true)}>Off{subtitleIndex === -1 ? " ✓" : ""}</button>
              {tracks.filter((track) => track.kind === "Subtitle").map((track) => (
                <button key={track.index} type="button" className="block" aria-pressed={track.index === subtitleIndex}
                  onClick={() => void selectTrack(audioIndex, track.index, true)}>
                  {track.label}{track.index === subtitleIndex ? " ✓" : ""}
                </button>
              ))}
              {trackBusy && <p role="status">Preparing track…</p>}
              {trackError && <p role="alert">Could not switch tracks. Try another track.</p>}
            </div>
          ) : <>
          <div className="prometheus-tv-player-title">
            <strong>{title}</strong>
            {episodeLabel && <span>{episodeLabel}</span>}
          </div>
          <div className="prometheus-tv-transport">
          <div className="prometheus-playback-timeline">
            <span>{formatTime(time.position)}</span>
            <input
              type="range"
              aria-label="Seek playback"
              aria-valuetext={formatTime(time.position)}
              className="min-w-0 flex-1 accent-red-500 focus:outline-2 focus:outline-offset-4 focus:outline-white"
              min={0}
              max={time.duration || 1}
              step="any"
              disabled={time.duration <= 0}
              value={Math.min(time.position, time.duration || 1)}
              onChange={(event) => {
                const video = videoRef.current;
                if (!video) return;
                keepControlsVisible();
                seek(video, event.currentTarget.valueAsNumber);
                updateTime(video);
              }}
            />
            <span aria-label="Time remaining">−{formatTime(Math.max(0, time.duration - time.position))}</span>
          </div>
          <button className="prometheus-tv-player-play" type="button" aria-label={paused ? "Play" : "Pause"} onClick={() => videoRef.current && togglePlayback(videoRef.current)}>
            <span aria-hidden="true" className={paused ? "prometheus-tv-play-icon" : "prometheus-tv-pause-icon"} />
          </button>
          </div>
          <div className="prometheus-tv-player-options">
          {tracks.length > 0 && (
            <button type="button" onClick={() => {
              if (hideTimer.current !== null) clearTimeout(hideTimer.current);
              setTrackError(false);
              setTrackMenu(true);
            }}>Audio &amp; Subtitles</button>
          )}
          <button type="button" onClick={() => {
            if (hideTimer.current !== null) clearTimeout(hideTimer.current);
            setAccessibilityMenu(true);
          }}>Accessibility</button>
          <button type="button" onClick={() => {
            const video = videoRef.current;
            if (hideTimer.current !== null) clearTimeout(hideTimer.current);
            setResolution({ width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0 });
            setInfoMenu(true);
          }}>Playback Info</button>
          {showSkipIntro && (
            <button type="button" onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              hideControls();
              seek(video, activeIntro.end);
            }}>Skip Intro</button>
          )}
          {nextEpisode && <button type="button" onClick={() => {
            setNextDismissed(false);
            setCountdown(8);
            setNextOpen(true);
          }}>Next Episode</button>}
          <button type="button" onClick={toggleFullscreen}>Fullscreen</button>
          <button type="button" onClick={hideControls}>Hide controls</button>
          </div>
          </>}
        </div>
      )}
    </div>
  );
}
