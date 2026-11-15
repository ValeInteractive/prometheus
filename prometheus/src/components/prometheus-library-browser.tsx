"use client";

import { MediaRow } from "@/components/library-rows";
import RandomUnwatched from "@/components/random-unwatched";
import PrometheusPoster from "@/components/prometheus-poster";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PrometheusMediaItem, PrometheusMediaType } from "@/lib/jellyfin/library";

const recentSearchesKey = "prometheus:recent-searches";
const recentLimit = 8;

function loadRecentSearches(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentSearchesKey) ?? "[]");
    return Array.isArray(value) ? value.filter((term): term is string =>
      typeof term === "string" && term.length > 0 && term.length <= 100,
    ).slice(0, recentLimit) : [];
  } catch {
    return [];
  }
}

type Result = { items: PrometheusMediaItem[]; error?: string; login?: boolean };

export default function PrometheusLibraryBrowser({ mode, rail = false }: { mode: "search" | "favourites"; rail?: boolean }) {
  const [input, setInput] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const query = input.trim();
  const [type, setType] = useState<PrometheusMediaType>("Movie");
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<{ key: string; result: Result } | null>(null);
  const ready = mode === "favourites" || query.length > 0;
  const params = new URLSearchParams({ mode, type, offset: String(offset) });
  if (mode === "search") params.set("q", query);
  const key = params.toString();
  const result = response?.key === key ? response.result : null;

  useEffect(() => {
    if (mode !== "search") return;
    const frame = window.requestAnimationFrame(() => setRecent(loadRecentSearches()));
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  function rememberSearch(term: string) {
    if (!term) return;
    const next = [term, ...recent.filter((previous) => previous.toLowerCase() !== term.toLowerCase())]
      .slice(0, recentLimit);
    setRecent(next);
    try {
      localStorage.setItem(recentSearchesKey, JSON.stringify(next));
    } catch {
      // Search can still be used when local storage is unavailable.
    }
  }

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    async function load() {
      try {
        if (rail) {
          const requests = await Promise.all((["Movie", "Series"] as const).map((category) =>
            fetch(`/api/library?mode=favourites&type=${category}`, { signal: controller.signal }),
          ));
          if (requests.some((request) => request.status === 401)) {
            if (!controller.signal.aborted) setResponse({ key, result: { items: [], login: true } });
            return;
          }
          if (requests.some((request) => !request.ok)) throw new Error("Library request failed.");
          const results: Result[] = await Promise.all(requests.map((request) => request.json()));
          if (!controller.signal.aborted) {
            setResponse({ key, result: { items: results.flatMap(({ items }) => items) } });
          }
          return;
        }
        const request = await fetch(`/api/library?${key}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (request.status === 401) {
          setResponse({ key, result: { items: [], login: true } });
          return;
        }
        if (!request.ok) throw new Error("Library request failed.");
        const data = await request.json();
        if (!controller.signal.aborted) setResponse({ key, result: data });
      } catch {
        if (!controller.signal.aborted) {
          setResponse({ key, result: { items: [], error: "The library is temporarily unavailable." } });
        }
      }
    }
    const timer = window.setTimeout(load, mode === "search" ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, mode, rail, ready]);

  if (rail) {
    return (
      <>
        <MediaRow homeRail id="saved-titles" title="My List" items={result?.items ?? []}
          emptyMessage={!result ? "Loading saved titles…" : result.login ? "Sign in to view your list." :
            result.error ?? "You haven't saved any titles yet."} />
        {result?.login && <Link href="/login">Sign in</Link>}
        {result && !result.login && !result.error && <div className="flex flex-wrap gap-3">
          <Link className="prometheus-button prometheus-button-secondary" href="/my-list?view=all">View Full List</Link>
        </div>}
      </>
    );
  }

  const button = "rounded bg-white/10 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <div className="prometheus-catalog-content space-y-5">
      {mode === "search" && (
        <form className="flex flex-wrap gap-3" onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          rememberSearch(query);
        }}>
          <input type="search" aria-label="Search titles" placeholder="Search titles" maxLength={100}
            className="min-w-48 rounded border border-white/30 px-4 py-2"
            value={input} onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget.form?.querySelector("button")?.focus();
              }
            }} onChange={(event) => {
              setOffset(0);
              setInput(event.target.value);
            }} />
          <button className={button} type="submit">Search</button>
        </form>
      )}
      {mode === "search" && !query && recent.length > 0 && (
        <section aria-label="Recent searches">
          <h2 className="mb-2 font-semibold">Recent searches</h2>
          <div className="flex flex-wrap gap-3">
            {recent.map((term) => (
              <button key={term} className={button} type="button" onClick={() => {
                setOffset(0);
                setInput(term);
                rememberSearch(term);
              }}>{term}</button>
            ))}
          </div>
        </section>
      )}
      <div className="flex gap-3" aria-label="Media type" role="group">
        {(["Movie", "Series"] as const).map((category) => (
          <button key={category} type="button" className={`${button} ${category === type ? "border border-white/60" : ""}`}
            aria-pressed={category === type} onClick={() => { setType(category); setOffset(0); }}>
            {category === "Movie" ? "Movies" : "TV Shows"}
          </button>
        ))}
      </div>
      {mode === "favourites" && type === "Movie" && result && !result.login && !result.error && <RandomUnwatched />}
      {ready && !result && <p role="status">Loading…</p>}
      {result?.login && <Link href="/login">Sign in to view your library</Link>}
      {result?.error && <p role="alert">{result.error}</p>}
      {result && !result.error && !result.login && result.items.length === 0 && (
        <p>{mode === "search" ? "No matching titles." : "No Jellyfin favourites in this category yet."}</p>
      )}
      {result && result.items.length > 0 && (
        <ul className="prometheus-search-poster-grid">
          {result.items.map((item) => (
            <li key={item.id}>
              <Link className="block rounded p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                onClick={mode === "search" ? () => rememberSearch(query) : undefined}
                data-poster-id={item.id} data-poster-title={item.title}
                data-poster-play={item.type === "Movie" ? `/watch/${item.id}` : `/series/${item.id}`}
                href={`/${item.type === "Movie" ? "movie" : "series"}/${item.id}`}>
                <div className="aspect-[2/3] overflow-hidden rounded">
                  <PrometheusPoster key={item.id} id={item.id} title={item.title} hasPoster={item.hasPoster} />
                </div>
                <span className="block">{item.title}</span>
                <span className="text-sm text-neutral-400">
                  {item.productionYear ?? "Year unknown"} · {item.type === "Movie" ? "Movie" : "TV Show"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <button className={button} type="button" disabled={offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - 30))}>Previous</button>
        <button className={button} type="button" disabled={result?.items.length !== 30}
          onClick={() => setOffset((value) => value + 30)}>Next</button>
      </div>
    </div>
  );
}
