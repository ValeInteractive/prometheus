"use client";

import "./prometheus-home-rails.css";
import FeaturedTrailer from "@/components/featured-trailer";
import PrometheusPoster from "@/components/prometheus-poster";
import Link from "next/link";
import { groupItemsByGenre, isLibrary, MediaRow, type Library } from "@/components/library-rows";

import {
  useEffect,
  useRef,
  useState,
} from "react";

interface ContinueItem {
  id: string;
  type: "Movie" | "Episode";
  title: string;
  seriesTitle: string | null;
  seriesId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  runtimeTicks: number;
  positionTicks: number;
  progressPercent: number;
  hasPoster: boolean;
}

type ContinueState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | {
      status: "ready";
      items: ContinueItem[];
    };

const ID_PATTERN = /^[a-f0-9]{32}$/i;

function isItem(
  value: unknown,
): value is ContinueItem {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    ID_PATTERN.test(item.id) &&
    (
      item.type === "Movie" ||
      item.type === "Episode"
    ) &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    typeof item.progressPercent === "number" &&
    Number.isFinite(item.progressPercent) &&
    item.progressPercent >= 0 &&
    item.progressPercent <= 100 &&
    typeof item.hasPoster === "boolean"
  );
}

function isContinueResponse(
  value: unknown,
): value is { items: ContinueItem[] } {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const data = value as Record<string, unknown>;

  return (
    Array.isArray(data.items) &&
    data.items.every(isItem)
  );
}

function displayTitle(item: ContinueItem) {
  if (
    item.type === "Episode" &&
    item.seriesTitle
  ) {
    return item.seriesTitle;
  }

  return item.title;
}

function episodeLabel(item: ContinueItem) {
  if (item.type !== "Episode") {
    return "Movie";
  }

  const season =
    typeof item.seasonNumber === "number"
      ? `S${String(item.seasonNumber).padStart(2, "0")}`
      : "";

  const episode =
    typeof item.episodeNumber === "number"
      ? `E${String(item.episodeNumber).padStart(2, "0")}`
      : "";

  const numbering = [season, episode]
    .filter(Boolean)
    .join(" ");

  return numbering
    ? `${numbering} · ${item.title}`
    : item.title;
}

function ContinueCard({
  item,
  backdropId,
}: {
  item: ContinueItem;
  backdropId?: string;
}) {
  const progress = Math.max(
    0,
    Math.min(100, item.progressPercent),
  );

  const minutesLeft = Math.ceil(Math.max(0, item.runtimeTicks - item.positionTicks) / 600_000_000);

  return (
    <Link
      href={`/watch/${encodeURIComponent(item.id)}`}
      aria-label={`Resume ${displayTitle(item)}`}
      data-poster-id={item.id} data-poster-title={displayTitle(item)}
      data-favourite-id={item.seriesId ?? item.id}
      data-poster-play={`/watch/${encodeURIComponent(item.id)}`} data-poster-resume="true"
      className="prometheus-card prometheus-resume-card group overflow-hidden focus-visible:outline-2 focus-visible:outline-white"
    >
      <div className="relative mb-3 aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800"
        data-home-backdrop={backdropId ? "true" : undefined}
        style={backdropId ? { backgroundImage: `url("/api/artwork?id=${encodeURIComponent(backdropId)}&type=Backdrop")` } : undefined}>
        <PrometheusPoster key={item.id} id={item.id} title={displayTitle(item)} hasPoster={item.hasPoster} />
      </div>

      <div className="prometheus-home-resume-progress" role="progressbar"
        aria-label={`${displayTitle(item)} watched`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="px-1 pb-2">
        <h3 className="line-clamp-2 text-base font-semibold text-white">
          {displayTitle(item)}
        </h3>

        <p className="mt-1 line-clamp-2 text-sm text-neutral-400">
          {episodeLabel(item)}
        </p>

        <p className="mt-2 text-xs text-neutral-400">
          {item.runtimeTicks > 0 && minutesLeft > 0 ? `${minutesLeft}m left` : `${progress}% watched`}
        </p>


      </div>
    </Link>
  );
}

type RecommendationItem = Library["movies"][number];

function rankRecommendations(
  titles: RecommendationItem[],
  history: RecommendationItem[],
  loadedAt: number,
) {
  const tastes = new Map<string, number>();
  const recentCutoff = loadedAt - 30 * 86_400_000;

  for (const item of history) {
    const recent = Date.parse(item.lastPlayedAt ?? "") >= recentCutoff;
    const weight = (item.favourite ? 3 : 0) + (item.played ? 2 : 0) + (recent ? 1 : 0);
    if (!weight) continue;

    const genres = new Set(item.genres.map((genre) => genre.trim().toLowerCase()).filter(Boolean));
    for (const genre of genres) {
      tastes.set(genre, (tastes.get(genre) ?? 0) + weight / genres.size);
    }
  }

  return titles.map((item) => {
    const score = Math.max(0, ...item.genres.map((genre) => tastes.get(genre.trim().toLowerCase()) ?? 0));
    return { item, score };
  }).sort((first, second) => second.score - first.score);
}

export default function ContinueWatchingRow({ tab = "home" }: {
  tab?: "home" | "movies" | "series" | "my-list";
} = {}) {
  const catalogue = tab === "movies" || tab === "series";
  const [state, setState] =
    useState<ContinueState>({
      status: "loading",
    });

  const [library, setLibrary] = useState<Library | "error" | null>(null);
  const [libraryLoadedAt, setLibraryLoadedAt] = useState<number | null>(null);
  const [previewFocused, setPreviewFocused] = useState(false);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const featuredSelection = useRef<string | null>(null);

  useEffect(() => {
    return () => { featuredSelection.current = null; };
  }, [tab]);

  const [refreshNumber, setRefreshNumber] =
    useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          "/api/continue-watching",
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) {
          return;
        }

        if (response.status === 401) {
          setState({
            status: "unauthenticated",
          });
          return;
        }

        if (!response.ok) {
          throw new Error(
            "Continue Watching unavailable.",
          );
        }

        const data: unknown =
          await response.json();

        if (!isContinueResponse(data)) {
          throw new Error(
            "Invalid Continue Watching response.",
          );
        }

        if (!controller.signal.aborted) {
          setState({
            status: "ready",
            items: data.items,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
          });
        }
      }
    }

    async function loadRecent() {
      try {
        const response = await fetch("/api/library", { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) {
          if (!controller.signal.aborted) setLibrary({ movies: [], series: [], recentlyAddedMovies: [], recentlyAddedSeries: [] });
          return;
        }
        if (!response.ok) throw new Error("Recent titles unavailable.");
        const data: unknown = await response.json();
        if (!isLibrary(data)) throw new Error("Invalid library response.");
        if (controller.signal.aborted) return;

        const loadedAt = Date.now();

        if (tab !== "my-list") {
          const films = [...data.movies, ...data.recentlyAddedMovies];
          const series = [...data.series, ...data.recentlyAddedSeries];
          const titles = tab === "movies" ? films : tab === "series" ? series : [...films, ...series];
          const unique = [...new Map(titles.map((item) => [item.id, item])).values()];
          if (!unique.some((item) => item.id === featuredSelection.current)) {
            const withBackdrop = unique.filter((item) => item.hasBackdrop);
            const pool = withBackdrop.length ? withBackdrop : unique;
            const key = `prometheus:last-featured:\${tab}`;
            let previous = featuredSelection.current;
            try {
              previous ??= sessionStorage.getItem(key);
            } catch {
              // Selection still works when session storage is unavailable.
            }

            const alternatives = pool.filter((item) => item.id !== previous);
            const candidates = alternatives.length ? alternatives : pool;
            const unseen = candidates.filter((item) => !item.played);
            const history = [...data.movies, ...data.series];
            const ranked = rankRecommendations(unseen.length ? unseen : candidates, history, loadedAt);
            const personalised = ranked.filter(({ score }) => score > 0).slice(0, 8);
            const picks = personalised.length ? personalised : ranked;
            const selected = picks[Math.floor(Math.random() * picks.length)]?.item;
            const id = selected?.id ?? null;
            featuredSelection.current = id;
            setFeaturedId(id);

            if (id) {
              try {
                sessionStorage.setItem(key, id);
              } catch {
                // Keeping the chosen title in memory is enough for this visit.
              }
            }
          }
        }

        setLibraryLoadedAt(loadedAt);
        setLibrary(data);
      } catch {
        if (!controller.signal.aborted) setLibrary("error");
      }
    }

    if (!catalogue) void load();
    void loadRecent();

    return () => controller.abort();
  }, [catalogue, refreshNumber, tab]);

  useEffect(() => {
    const refresh = () => setRefreshNumber((value) => value + 1);
    window.addEventListener("prometheus:title-changed", refresh);
    function refreshIfVisible() {
      if (
        document.visibilityState === "visible"
      ) {
        setRefreshNumber(
          (value) => value + 1,
        );
      }
    }

    document.addEventListener(
      "visibilitychange",
      refreshIfVisible,
    );

    return () => {
      window.removeEventListener("prometheus:title-changed", refresh);
      document.removeEventListener(
        "visibilitychange",
        refreshIfVisible,
      );
    };
  }, []);

  function retry() {
    setState({
      status: "loading",
    });

    setRefreshNumber(
      (value) => value + 1,
    );
  }

  // Jellyfin's Resume feed puts the latest activity first.
  const seen = new Set<string>();
  const items = (state.status === "ready" ? state.items : []).filter((item) => {
    const id = (item.seriesId ?? item.id).toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const films = library && library !== "error" ? library.recentlyAddedMovies : [];
  const series = library && library !== "error" ? library.recentlyAddedSeries : [];
  const featuredItems = tab === "movies" ? films : tab === "series" ? series : [...films, ...series];
  const featured = library && library !== "error" && featuredId
    ? [...library.movies, ...library.series, ...films, ...series].find((item) => item.id === featuredId)
    : undefined;
  const featuredKey = featured?.id.toLowerCase();
  const nextWatch = catalogue
    ? featuredItems.filter((item) => item.id.toLowerCase() !== featuredKey)
    : [];
  const allTitles = library && library !== "error"
    ? [...library.movies, ...library.series]
    : [];
  const tabTitles = tab === "movies"
    ? allTitles.filter((item) => item.type === "Movie")
    : tab === "series"
      ? allTitles.filter((item) => item.type === "Series")
      : allTitles;
  const uniqueTabTitles = [...new Map(tabTitles.map((item) =>
    [item.id.toLowerCase(), item],
  )).values()];
  const completeGenreRows = groupItemsByGenre(catalogue ? uniqueTabTitles : []);

  const backdropIds = new Set(
    library && library !== "error"
      ? [...library.movies, ...library.series, ...library.recentlyAddedMovies, ...library.recentlyAddedSeries]
          .filter((item) => item.hasBackdrop).map((item) => item.id.toLowerCase())
      : [],
  );
  const recommended = tab !== "my-list" && libraryLoadedAt !== null
    ? rankRecommendations(
        uniqueTabTitles.filter((item) =>
          !item.played && !seen.has(item.id.toLowerCase()) &&
          item.id.toLowerCase() !== featuredKey,
        ),
        allTitles,
        libraryLoadedAt,
      ).slice(0, 10).map(({ item }) => item)
    : [];
  const recommendedIds = new Set(recommended.map((item) => item.id.toLowerCase()));
  const details = featured ? `/${featured.type === "Movie" ? "movie" : "series"}/${featured.id}` : null;

  return (
    <>
      {tab !== "my-list" && <section className="prometheus-tv-feature relative"
        onFocus={() => setPreviewFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPreviewFocused(false);
        }}
        style={featured?.hasBackdrop ? { backgroundImage:
          `linear-gradient(90deg, #080808ee, #08080855 58%, transparent), linear-gradient(0deg, #080808d9, transparent 65%), url("/api/artwork?id=${encodeURIComponent(featured.id)}&type=Backdrop")` } : undefined}>
        {featured && previewFocused && (
          <FeaturedTrailer key={featured.id} id={featured.id} type={featured.type} />
        )}
        <div className="relative">
          <h1>{featured?.title ?? (tab === "movies" ? "Films" : tab === "series" ? "Series" : "Prometheus")}</h1>
          {featured && details && (
            <>
              <p>{[featured.type === "Movie" ? "Movie" : "TV Show", featured.productionYear,
                featured.genres[0]].filter(Boolean).join(" · ")}</p>
              <div className="prometheus-actions prometheus-tv-actions">
                {featured.type === "Movie" && <Link className="prometheus-button prometheus-tv-play"
                  href={`/watch/${featured.id}`} data-poster-id={featured.id}
                  data-poster-title={featured.title} data-poster-play={`/watch/${featured.id}`}>▶ Play</Link>}
                <Link className="prometheus-button prometheus-button-secondary" href={details}>More Info</Link>
              </div>
            </>
          )}
        </div>
      </section>}
      {tab === "home" && !featured && <div className="prometheus-actions prometheus-tv-home-shortcuts">
        <Link className="prometheus-button prometheus-button-secondary" href="/movies">Explore Movies</Link>
        <Link className="prometheus-button prometheus-button-secondary" href="/series">Browse TV Shows</Link>
        <Link className="prometheus-button prometheus-button-secondary" href="/my-list">My List</Link>
      </div>}
      {!catalogue && (tab === "my-list" || state.status !== "ready" || items.length > 0) && (
        <section
          className="prometheus-row"
          id="watching"
          aria-label="Continue Watching"
        >
          <h2>Continue Watching</h2>

          {state.status === "loading" && (
            <p
              role="status"
              className="py-6 text-sm text-neutral-400"
            >
              Loading your viewing progress...
            </p>
          )}

          {state.status === "unauthenticated" && (
            <p className="py-6 text-sm text-neutral-400">
              Sign in to see your viewing progress.
            </p>
          )}

          {state.status === "error" && (
            <div className="space-y-4 py-6">
              <p
                role="alert"
                className="text-sm text-neutral-400"
              >
                Continue Watching is temporarily unavailable.
              </p>

              <button
                type="button"
                onClick={retry}
                className="prometheus-button prometheus-button-secondary"
              >
                Try Again
              </button>
            </div>
          )}

          {state.status === "ready" && items.length === 0 && <p>No titles in progress.</p>}
          {state.status === "ready" && items.length > 0 && (
            <div className="prometheus-home-rail">
              {items.map((item) => {
                const id = item.seriesId ?? item.id;
                return <ContinueCard key={item.id} item={item} backdropId={backdropIds.has(id.toLowerCase()) ? id : undefined} />;
              })}
            </div>
          )}
        </section>
      )}
      {catalogue && <>
        {nextWatch.length > 0 && <MediaRow homeRail id="your-next-watch" title="Your Next Watch" items={nextWatch} />}
        {recommended.length > 0 && (
          <MediaRow homeRail id="recommended-for-you" title="Recommended for You" items={recommended} />
        )}
        {completeGenreRows.map(({ genre, items }) => (
          <MediaRow key={genre} homeRail id={`catalogue-genre-${encodeURIComponent(genre.toLowerCase())}`}
            title={genre} items={items} />
        ))}
        {library === null && <p role="status" data-catalogue-loading>Loading titles…</p>}
        {library === "error" && <p role="alert">Titles are temporarily unavailable.</p>}
        {library !== null && <div className="flex flex-wrap gap-3">
          <Link className="prometheus-button prometheus-button-secondary" href={`/${tab}?view=all`}>Browse All {tab === "movies" ? "Films" : "Series"}</Link>
          <Link className="prometheus-button prometheus-button-secondary" href={`/${tab}?view=genres`}>Browse Genres</Link>
        </div>}
      </>}
      {tab === "home" && state.status !== "loading" && state.status !== "unauthenticated" && library && library !== "error" && (
        <>
          {recommended.length > 0 && (
            <MediaRow homeRail id="recommended-for-you" title="Recommended for You" items={recommended} />
          )}
          <MediaRow homeRail id="recently-added-movies" title="Recently Added Movies"
            items={library.recentlyAddedMovies.filter((item) =>
              !seen.has(item.id.toLowerCase()) && !recommendedIds.has(item.id.toLowerCase()),
            )} />
          <MediaRow homeRail id="recently-added-series" title="Recently Added TV Shows"
            items={library.recentlyAddedSeries.filter((item) =>
              !seen.has(item.id.toLowerCase()) && !recommendedIds.has(item.id.toLowerCase()),
            )} />
        </>
      )}
      {tab === "home" && state.status !== "loading" && state.status !== "unauthenticated" && library === "error" && (
        <p role="alert">Recently added titles are temporarily unavailable.{" "}
          <button type="button" className="prometheus-button prometheus-button-secondary"
            onClick={retry}>Try Again</button>
        </p>
      )}
    </>
  );
}
