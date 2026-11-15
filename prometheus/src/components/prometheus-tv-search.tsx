"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isLibrary, type Library } from "@/components/library-rows";
import PrometheusPoster from "@/components/prometheus-poster";

const keys = "abcdefghijklmnopqrstuvwxyz1234567890".split("");
const keyStyle = "grid min-h-9 place-items-center rounded bg-white/10 text-lg focus-visible:bg-white focus-visible:text-black";
const normalise = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function PrometheusTvSearch() {
  const [library, setLibrary] = useState<Library | "login" | "error" | null>(null);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const firstKey = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/library", { signal: controller.signal });
        if (response.status === 401) {
          if (!controller.signal.aborted) setLibrary("login");
          return;
        }
        if (!response.ok) throw new Error("Library unavailable.");
        const data: unknown = await response.json();
        if (!isLibrary(data)) throw new Error("Invalid library response.");
        if (!controller.signal.aborted) setLibrary(data);
      } catch {
        if (!controller.signal.aborted) setLibrary("error");
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const titles = library && typeof library !== "string"
    ? [...new Map([...library.movies, ...library.series].map((item) => [item.id.toLowerCase(), item])).values()]
    : [];
  const genres = [...new Set(titles.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
  const term = normalise(query.trim());
  const results = genre
    ? titles.filter((item) => item.genres.includes(genre))
    : term
      ? titles.filter((item) => normalise(item.title).includes(term) ||
          item.genres.some((tag) => normalise(tag).includes(term)))
        .sort((a, b) => Number(normalise(b.title).startsWith(term)) - Number(normalise(a.title).startsWith(term)))
      : [...titles].sort((a, b) => Number(Boolean(a.played)) - Number(Boolean(b.played)) ||
          (b.dateCreated ?? "").localeCompare(a.dateCreated ?? "")).slice(0, 24);

  function updateQuery(value: string) {
    setGenre("");
    setQuery(value.slice(0, 100));
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(12rem,23%)_minmax(0,1fr)] md:gap-[4vw]">
      <div className="space-y-3">
        <input type="search" aria-label="Search films and series" placeholder="Search"
          className="w-full rounded border border-white/25 bg-white/5 px-3 py-2"
          value={query} maxLength={100} onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              firstKey.current?.focus();
            }
          }} />
        <div className="grid grid-cols-6 gap-1" role="group" aria-label="On-screen keyboard">
          <button type="button" aria-label="Space" className={`${keyStyle} col-span-3`}
            onClick={() => updateQuery(query + " ")}>␣</button>
          <button type="button" aria-label="Backspace" className={`${keyStyle} col-span-3`}
            onClick={() => updateQuery(query.slice(0, -1))}>⌫</button>
          {keys.map((key) => (
            <button key={key} type="button" className={keyStyle}
              ref={key === "a" ? firstKey : undefined} data-tv-search-start={key === "a" ? "" : undefined}
              onClick={() => updateQuery(query + key)}>{key}</button>
          ))}
        </div>
        <nav className="grid gap-1" aria-label="Search by genre">
          {genres.map((tag) => (
            <button key={tag} type="button" aria-pressed={genre === tag}
              className="rounded px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/20 aria-pressed:bg-white/15"
              onClick={() => {
                setQuery("");
                setGenre(genre === tag ? "" : tag);
              }}>{tag}</button>
          ))}
        </nav>
      </div>
      <section aria-labelledby="tv-search-heading">
        <h1 id="tv-search-heading" className="mb-3 text-2xl font-semibold">
          {genre || (term ? "Search results" : "Your search recommendations")}
        </h1>
        {library === null && <p role="status">Loading titles…</p>}
        {library === "login" && <Link href="/login">Sign in to search your library</Link>}
        {library === "error" && <p role="alert">Search is temporarily unavailable.</p>}
        {library && typeof library !== "string" && results.length === 0 && (
          <p role="status">{term ? "No matching titles." : "No titles available."}</p>
        )}
        <ul className="prometheus-search-poster-grid gap-2! grid-cols-4!">
          {results.map((item) => (
            <li key={item.id} className="min-w-0">
              <Link href={`/${item.type === "Movie" ? "movie" : "series"}/${item.id}`}
                aria-label={item.title} data-poster-id={item.id} data-poster-title={item.title}
                data-poster-play={item.type === "Movie" ? `/watch/${item.id}` : `/series/${item.id}`}
                className="block aspect-[2/3] overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-white">
                <PrometheusPoster id={item.id} title={item.title} hasPoster={item.hasPoster} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
