"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import MovieCard, { type MovieCardItem } from "@/components/movie-card";
import PrometheusHeader from "@/components/prometheus-header";

function CollectionDetails({ id }: { id: string }) {
  const [collection, setCollection] = useState<{ title: string; movies: MovieCardItem[] } | null>(null);
  const [problem, setProblem] = useState<"login" | "unavailable" | null>(null);
  const validId = /^[a-f0-9]{32}$/i.test(id);

  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/movie?mode=collection&id=${id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setProblem("login");
          return;
        }
        if (!response.ok) throw new Error("Collection unavailable.");
        const data = await response.json();
        if (typeof data?.title !== "string" || !Array.isArray(data.movies)) throw new Error("Invalid collection.");
        if (!controller.signal.aborted) setCollection(data);
      } catch {
        if (!controller.signal.aborted) setProblem("unavailable");
      }
    }
    void load();
    return () => controller.abort();
  }, [id, validId]);

  return (
    <>
      <PrometheusHeader />
      <main className="prometheus-catalog-content">
        <h1 className="mb-5 text-3xl font-bold">{collection?.title ?? "Collection"}</h1>
        {problem === "login" && <Link href="/login">Sign in to view this collection</Link>}
        {(!validId || problem === "unavailable") && <p role="alert">Collection unavailable.</p>}
        {validId && !problem && !collection && <p role="status">Loading collection…</p>}
        {collection && (collection.movies.length > 0 ? (
          <div className="prometheus-card-grid" aria-label="Films in release order">
            {collection.movies.map((movie) => <MovieCard key={movie.id} item={movie} />)}
          </div>
        ) : <p>No films are available in this collection.</p>)}
      </main>
    </>
  );
}

function CollectionRoute() {
  const { id } = useParams();
  const collectionId = typeof id === "string" ? id : "";
  return <CollectionDetails key={collectionId} id={collectionId} />;
}

export default function CollectionPage() {
  return <Suspense fallback={<p role="status">Loading collection…</p>}><CollectionRoute /></Suspense>;
}
