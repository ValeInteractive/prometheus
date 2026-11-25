"use client";

import { primaryGenre, primaryGenreChanged } from "@/lib/primary-genre";
import RandomUnwatched from "@/components/random-unwatched";
import MovieCard from "@/components/movie-card";

import PrometheusPoster from "@/components/prometheus-poster";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useState,
} from "react";

interface CollectionSummary {
  id: string;
  title: string;
  hasPoster: boolean;
  movieIds: string[];
}

interface MediaItem {
  id: string;
  collection?: { count: number; fallbackPosterId?: string };
  type: "Movie" | "Series";
  title: string;
  overview: string | null;
  productionYear: number | null;
  genres: string[];
  communityRating: number | null;
  runtimeTicks: number | null;
  dateCreated: string | null;
  hasPoster: boolean;
  hasBackdrop: boolean;
  played?: boolean;
  favourite?: boolean;
  lastPlayedAt?: string | null;
}

export interface Library {
  movies: MediaItem[];
  series: MediaItem[];
  recentlyAddedMovies: MediaItem[];
  recentlyAddedSeries: MediaItem[];
}

type LibraryState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ready"; items: MediaItem[] };

export function isLibrary(value: unknown): value is Library {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Record<string, unknown>;

  return (
    Array.isArray(data.movies) &&
    Array.isArray(data.series) &&
    Array.isArray(data.recentlyAddedMovies) &&
    Array.isArray(data.recentlyAddedSeries)
  );
}

export function groupItemsByGenre(items: MediaItem[]) {
  const groups = new Map<string, { genre: string; items: MediaItem[] }>();

  for (const item of items) {
    const genre = primaryGenre(item.id, item.genres) || "Uncategorised";
    const key = genre.toLowerCase();
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { genre, items: [item] });
  }

  return [...groups.values()].sort((first, second) =>
    first.genre.localeCompare(second.genre, undefined, {
      sensitivity: "base",
    }),
  );
}

function MediaCard({
  item, homeRail,
}: {
  item: MediaItem;
  homeRail: boolean;
}) {
  return (
    <article
      className="prometheus-card group overflow-hidden"
      aria-label={`${item.title}, ${item.type}`}
    >
      <div className="relative mb-3 aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800">
        <Link
          href={`/series/${encodeURIComponent(item.id)}`}
          aria-label={`Browse ${item.title}`}
          data-poster-id={item.id}
          data-poster-title={item.title}
          data-poster-genres={JSON.stringify(item.genres)}
          data-poster-play={`/series/${encodeURIComponent(item.id)}`}
          className="absolute inset-0 z-[1]"
          data-home-backdrop={homeRail && item.hasBackdrop ? "true" : undefined}
          style={homeRail && item.hasBackdrop ? { backgroundImage: `url("/api/artwork?id=${encodeURIComponent(item.id)}&type=Backdrop")` } : undefined}
        >
          <PrometheusPoster key={item.id} id={item.id} title={item.title} hasPoster={item.hasPoster} />
        </Link>
      </div>

      <div className="px-1 pb-2">
        <h3 className="line-clamp-2 text-base font-semibold text-white">
          {item.title}
        </h3>

        <p className="mt-1 text-sm text-neutral-400">
          {item.productionYear ?? "Year unknown"}
          {" · "}
          {item.type === "Movie" ? "Movie" : "TV Series"}
        </p>

        {item.overview && (
          <p className="mt-2 line-clamp-3 text-sm text-neutral-400">
            {item.overview}
          </p>
        )}

        {item.type === "Movie" && (
          <Link
            href={`/watch/${encodeURIComponent(item.id)}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Watch Movie
          </Link>
        )}

        {item.type === "Series" && (
          <Link
            href={`/series/${encodeURIComponent(item.id)}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Browse Episodes
          </Link>
        )}
      </div>
    </article>
  );
}

export function MediaRow({
  id,
  title,
  items,
  homeRail = false,
  cataloguePreviews = false,
  emptyMessage = "Nothing to show here yet.",
}: {
  id: string;
  title: string;
  items: MediaItem[];
  homeRail?: boolean;
  cataloguePreviews?: boolean;
  emptyMessage?: string;
}) {
  function renderCard(item: MediaItem) {
    if (item.collection) {
      const label = `${item.title} · ${item.collection.count} films`;
      return (
        <article key={item.id} className="prometheus-card">
          <div>
            <Link href={`/collections/${item.id}`} aria-label={label}
              data-poster-id={item.id} data-poster-title={item.title}
              className="absolute inset-0 block">
              <PrometheusPoster id={item.collection.fallbackPosterId ?? item.id}
                title={item.title} hasPoster={item.hasPoster} />
              <span className="absolute inset-x-0 bottom-0 bg-black/80 px-3 py-2 text-sm font-semibold text-white">
                {label}
              </span>
            </Link>
          </div>
        </article>
      );
    }
    return item.type === "Movie" || homeRail || cataloguePreviews ? (
      <MovieCard key={item.id} item={item} homeRail={homeRail} seriesPreview={item.type === "Series"} />
    ) : (
      <MediaCard key={item.id} item={item} homeRail={homeRail} />
    );
  }

  return (
    <section className="prometheus-row" id={id}>
      <h2>{title}</h2>

      {items.length > 0 ? (
        <div className={homeRail ? "prometheus-home-rail" : cataloguePreviews
          ? "prometheus-card-grid prometheus-catalogue-poster-rows" : "prometheus-card-grid"}>
          {cataloguePreviews
            ? Array.from({ length: Math.ceil(items.length / 5) }, (_, index) => (
                <div className="prometheus-catalogue-poster-row" key={items[index * 5].id}>
                  {items.slice(index * 5, index * 5 + 5).map(renderCard)}
                </div>
              ))
            : items.map(renderCard)}
        </div>
      ) : (
        <p className="py-6 text-sm text-neutral-400">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

const catalogueSorts = [
  { value: "title", label: "Title A–Z" },
  { value: "year", label: "Release year" },
  { value: "added", label: "Date added" },
] as const;

type CatalogueSort = (typeof catalogueSorts)[number]["value"];
const alphabet = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

function titleInitial(title: string) {
  const initial = title.trim().normalize("NFD").replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(initial) ? initial : "#";
}

export default function LibraryRows({
  category,
}: {
  category: "movies" | "series";
}) {
  const categoryTitle = category === "movies" ? "Movies" : "TV Shows";
  const params = useSearchParams();
  const view = params.get("view") === "genres" ? "genres" : "all";
  const genre = params.get("genre");
  const requestedSort = params.get("sort");
  const sort = catalogueSorts.find((option) => option.value === requestedSort)?.value ?? "title";
  const requestedLetter = params.get("letter");
  const letter = sort === "title" && requestedLetter && alphabet.includes(requestedLetter)
    ? requestedLetter
    : null;
  const type = category === "movies" ? "Movie" : "Series";
  const groupCollections = type === "Movie" && view === "all";
  const [collections, setCollections] = useState<CollectionSummary[]>([]);



  function catalogueHref(
    view: "all" | "genres",
    genre?: string,
    order: CatalogueSort = sort,
    initial: string | null = null,
  ) {
    const query = new URLSearchParams();
    if (view === "genres") query.set("view", view);
    if (genre) query.set("genre", genre);
    if (order !== "title") query.set("sort", order);
    if (order === "title" && initial) query.set("letter", initial);
    return `/${category}${query.size ? "?" + query : ""}`;
  }
  const [state, setState] =
    useState<LibraryState>({ status: "loading" });

  const [refreshNumber, setRefreshNumber] =
    useState(0);

  useEffect(() => {
    if (!groupCollections) return;
    const controller = new AbortController();
    async function loadCollections() {
      try {
        const response = await fetch("/api/movie?mode=collections", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Collections unavailable.");
        const data = await response.json();
        if (!Array.isArray(data.collections)) throw new Error("Invalid collections response.");
        if (!controller.signal.aborted) setCollections(data.collections);
      } catch {
        if (!controller.signal.aborted) setCollections([]);
      }
    }
    void loadCollections();
    return () => controller.abort();
  }, [groupCollections, refreshNumber]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/library?mode=catalogue&type=${type}`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }

        if (!response.ok) {
          throw new Error("Library unavailable.");
        }

        const data = await response.json();
        if (!Array.isArray(data?.items)) throw new Error("Invalid catalogue response.");
        if (controller.signal.aborted) return;
        const unique = new Map<string, MediaItem>();
        for (const item of data.items as MediaItem[]) unique.set(item.id.toLowerCase(), item);
        setState({ status: "ready", items: [...unique.values()] });
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [refreshNumber, type]);

  useEffect(() => {
    function refreshGenres() {
      setState((current) => current.status === "ready" ? { ...current } : current);
    }
    window.addEventListener(primaryGenreChanged, refreshGenres);
    return () => window.removeEventListener(primaryGenreChanged, refreshGenres);
  }, []);

  // Refresh periodically while PROMETHEUS is visible.
  // Hidden tabs do not need continuous library requests.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setRefreshNumber((value) => value + 1);
      }
    }, 90_000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        setRefreshNumber((value) => value + 1);
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      window.clearInterval(interval);

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, []);

  function refresh() {
    setState({ status: "loading" });
    setRefreshNumber((value) => value + 1);
  }

  if (state.status === "loading") {
    return (
      <section
        className="prometheus-row"
        aria-live="polite"
      >
        <h2>{categoryTitle}</h2>
        <p className="py-6 text-neutral-400">
          {`Loading your ${categoryTitle.toLowerCase()}...`}
        </p>
      </section>
    );
  }

  if (state.status === "unauthenticated") {
    return (
      <section className="prometheus-row">
        <h2>{categoryTitle}</h2>

        <p className="mb-5 text-neutral-400">
          {`Sign in to browse your ${categoryTitle.toLowerCase()}.`}
        </p>

        <Link
          href="/login"
          className="prometheus-button prometheus-button-primary"
        >
          Sign In
        </Link>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="prometheus-row">
        <h2>{categoryTitle}</h2>

        <p
          role="alert"
          className="mb-5 text-neutral-400"
        >
          {`Your ${categoryTitle.toLowerCase()} are temporarily unavailable.`}
        </p>

        <button
          type="button"
          onClick={refresh}
          className="prometheus-button prometheus-button-secondary"
        >
          Try Again
        </button>
      </section>
    );
  }

  const items = state.items;
  const groups = view === "genres" ? groupItemsByGenre(items) : [];
  const selected = groups.find((group) => group.genre.toLowerCase() === genre?.toLowerCase());
  const standalone = new Map(items.map((item) => [item.id.toLowerCase(), item]));
  const collectionCards: MediaItem[] = [];

  if (groupCollections) {
    for (const collection of collections) {
      const members = collection.movieIds.flatMap((id) => {
        const item = standalone.get(id.toLowerCase());
        return item ? [item] : [];
      });
      if (members.length < 2) continue;

      const fallbackPoster = members.find((item) => item.hasPoster);
      const newest = members.reduce((latest, item) =>
        (item.dateCreated ?? "") > (latest.dateCreated ?? "") ? item : latest,
      );
      const years = members.flatMap((item) => item.productionYear === null ? [] : [item.productionYear]);

      collectionCards.push({
        ...members[0],
        id: collection.id,
        title: collection.title,
        productionYear: years.length ? Math.min(...years) : null,
        dateCreated: newest.dateCreated,
        hasPoster: collection.hasPoster || Boolean(fallbackPoster),
        collection: {
          count: members.length,
          fallbackPosterId: collection.hasPoster ? undefined : fallbackPoster?.id,
        },
      });

      for (const member of members) standalone.delete(member.id.toLowerCase());
    }
  }

  const titles = view === "all"
    ? [...standalone.values(), ...collectionCards]
    : selected?.items ?? [];
  const letters = new Set(titles.map((item) => titleInitial(item.title)));
  const results = titles.filter((item) => !letter || titleInitial(item.title) === letter)
    .sort((first, second) => {
      const order = sort === "year"
        ? (second.productionYear ?? 0) - (first.productionYear ?? 0)
        : sort === "added"
          ? (second.dateCreated ?? "").localeCompare(first.dateCreated ?? "")
          : 0;
      return order || first.title.localeCompare(second.title, "en", { sensitivity: "base", numeric: true })
        || first.id.localeCompare(second.id);
    });

  return (
    <>
      <nav className="mb-6 flex flex-wrap gap-3" aria-label="Catalogue view">
        <Link href={catalogueHref("all")} aria-current={view === "all" ? "page" : undefined}
          className={`prometheus-button ${view === "all" ? "prometheus-button-primary" : "prometheus-button-secondary"}`}>All</Link>
        <Link href={catalogueHref("genres")} aria-current={view === "genres" ? "page" : undefined}
          className={`prometheus-button ${view === "genres" ? "prometheus-button-primary" : "prometheus-button-secondary"}`}>Genres</Link>
        <button type="button" onClick={refresh} className="prometheus-button prometheus-button-secondary">Refresh Library</button>
      </nav>

      {view === "genres" && !selected ? (
        <section className="prometheus-row prometheus-genre-browser">
          <h2>Genres</h2>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-4">
            {groups.map(({ genre, items }) => (
              <li key={genre.toLowerCase()}>
                <Link href={catalogueHref("genres", genre)} data-genre-tile={genre.toLowerCase()}
                  className="flex min-h-24 flex-col justify-center gap-1 rounded-xl border border-white/20 bg-neutral-900 px-5 py-4 hover:border-[#c9ad7c] focus-visible:outline-2 focus-visible:outline-offset-4">
                  <span className="text-lg font-semibold">{genre}</span>
                  <span className="text-sm text-neutral-300">
                    {items.length} {items.length === 1 ? "title" : "titles"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!groups.length && <p className="text-neutral-400">No genres are available yet.</p>}
        </section>
      ) : (
        <>
          {selected && <Link href={catalogueHref("genres")} className="prometheus-button prometheus-button-secondary mb-4">Back to Genres</Link>}
          {selected && category === "movies" && <RandomUnwatched genre={selected.genre} />}
          <nav className="mb-4 flex flex-wrap gap-3" aria-label="Sort catalogue">
            {catalogueSorts.map((option) => (
              <Link key={option.value} href={catalogueHref(view, selected?.genre, option.value)}
                aria-current={sort === option.value ? "true" : undefined}
                className={`prometheus-button ${sort === option.value ? "prometheus-button-primary" : "prometheus-button-secondary"}`}>
                {option.label}
              </Link>
            ))}
          </nav>
          {sort === "title" && letters.size > 0 && (
            <nav className="mb-5 flex flex-wrap gap-2" aria-label="Jump to titles by first letter">
              <Link href={catalogueHref(view, selected?.genre)} aria-current={!letter ? "true" : undefined}
                className={`prometheus-button ${!letter ? "prometheus-button-primary" : "prometheus-button-secondary"}`}>All letters</Link>
              {alphabet.filter((initial) => letters.has(initial)).map((initial) => (
                <Link key={initial} href={catalogueHref(view, selected?.genre, "title", initial)}
                  aria-current={letter === initial ? "true" : undefined}
                  className={`prometheus-button ${letter === initial ? "prometheus-button-primary" : "prometheus-button-secondary"}`}>
                  {initial}
                </Link>
              ))}
            </nav>
          )}
          <p className="prometheus-catalogue-count">
            {results.length} {results.length === 1 ? "title" : "titles"}
            {letter ? ` beginning with ${letter}` : ""}
          </p>
          <MediaRow cataloguePreviews id={selected ? `${category}-genre` : category}
            title={selected?.genre ?? `All ${categoryTitle}`}
            items={results} />
        </>
      )}
    </>
  );
}
