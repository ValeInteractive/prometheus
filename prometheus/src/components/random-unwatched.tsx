"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { primaryGenre } from "@/lib/primary-genre";
import type { PrometheusMediaItem } from "@/lib/jellyfin/library";

export default function RandomUnwatched({ genre, currentId }: { genre?: string; currentId?: string }) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function pick() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const mode = genre ? "catalogue" : "random-favourites";
      const response = await fetch(`/api/library?mode=${mode}&type=Movie`, { cache: "no-store" });
      if (!response.ok) throw new Error("Library unavailable.");
      const { items } = await response.json() as { items: PrometheusMediaItem[] };
      const candidates = items.filter((item) => item.type === "Movie" && item.played === false &&
        item.id.toLowerCase() !== currentId?.toLowerCase() &&
        (!genre || primaryGenre(item.id, item.genres)?.toLowerCase() === genre.toLowerCase()));
      if (!candidates.length) {
        setMessage(currentId ? "No other unwatched films here." : "No unwatched films here.");
        return;
      }

      const film = candidates[Math.floor(Math.random() * candidates.length)];
      const query = new URLSearchParams(genre ? { random: "genre", genre } : { random: "my-list" });
      const href = `/movie/${encodeURIComponent(film.id)}?${query}`;
      if (currentId) router.replace(href);
      else router.push(href);
    } catch {
      setMessage("Could not pick a film. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-3">
      <button type="button" aria-disabled={busy} onClick={() => void pick()}
        className="prometheus-button prometheus-button-secondary">
        {busy ? "Picking…" : currentId ? "Pick Another" : "Random Unwatched"}
      </button>
      {message && <span role="status">{message}</span>}
    </div>
  );
}
