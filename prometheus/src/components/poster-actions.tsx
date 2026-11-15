"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { genreOptions, readGenreOverride, saveGenreOverride } from "@/lib/primary-genre";
import { focusElement } from "@/components/prometheus-remote-navigation";

export default function PosterActions() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState("");
  const [showGenres, setShowGenres] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let press: { target: HTMLElement; timer: number; opened: boolean } | null = null;
    function cancelPress() {
      if (press) window.clearTimeout(press.timer);
      press = null;
    }
    function open(element: HTMLElement) {
      setStatus("");
      setShowGenres(false);
      setTarget(element);
    }
    function down(event: KeyboardEvent) {
      const modal = dialog.current;
      if (modal?.open) {
        if (event.key === "BrowserBack" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          modal.close();
        } else if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const controls = [...modal.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
          const current = controls.indexOf(document.activeElement as HTMLElement);
          const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
          controls[Math.max(0, Math.min(controls.length - 1, current + offset))]?.focus();
        } else if (event.key === "Enter" && (press?.opened || event.repeat)) {
          event.preventDefault();
        }
        return;
      }
      const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-poster-id]") : null;
      if (event.key !== "Enter" || !element || event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (press || event.repeat) return;
      const timer = window.setTimeout(() => {
        if (!press || document.activeElement !== element) return;
        press.opened = true;
        open(element);
      }, 550);
      press = { target: element, timer, opened: false };
    }
    function up(event: KeyboardEvent) {
      if (event.key !== "Enter" || !press) return;
      event.preventDefault();
      const current = press;
      cancelPress();
      if (!current.opened && current.target === document.activeElement) current.target.click();
    }
    function context(event: MouseEvent) {
      const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-poster-id]") : null;
      if (!element) return;
      event.preventDefault();
      cancelPress();
      open(element);
    }
    function focusChanged(event: FocusEvent) {
      if (press && !press.opened && event.target !== press.target) cancelPress();
    }
    document.addEventListener("keydown", down, true);
    document.addEventListener("keyup", up, true);
    document.addEventListener("contextmenu", context);
    document.addEventListener("focusin", focusChanged);
    window.addEventListener("blur", cancelPress);
    return () => {
      cancelPress();
      document.removeEventListener("keydown", down, true);
      document.removeEventListener("keyup", up, true);
      document.removeEventListener("contextmenu", context);
      document.removeEventListener("focusin", focusChanged);
      window.removeEventListener("blur", cancelPress);
    };
  }, []);

  useEffect(() => {
    if (target && !dialog.current?.open) dialog.current?.showModal();
  }, [target]);

  async function act(action: string) {
    if (!target || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/title-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action === "favourite" ? target.dataset.favouriteId ?? target.dataset.posterId : target.dataset.posterId, action }),
      });
      if (!response.ok) throw new Error();
      setStatus(action === "favourite" ? "Added to My List." : action === "watched" ? "Marked watched." : "Removed from Continue Watching.");
      window.dispatchEvent(new Event("prometheus:title-changed"));
    } catch {
      setStatus("Could not save the change. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const genres = genreOptions(JSON.parse(target?.dataset.posterGenres ?? "[]") as string[]);
  const posterId = target?.dataset.posterId;

  function changeGenre(genre: string | null) {
    if (!posterId) return;
    try {
      saveGenreOverride(posterId, genre);
      dialog.current?.close();
    } catch {
      setStatus("Could not save the primary genre.");
    }
  }

  const play = target?.dataset.posterPlay;
  const button = "rounded bg-white/10 px-4 py-2 text-left focus:outline-2 focus:outline-white";
  return (
    <dialog ref={dialog} aria-label="Title actions"
      className="m-auto max-w-[90vw] rounded-xl border border-white/30 bg-neutral-900 p-6 text-white backdrop:bg-black/75"
      onClose={() => {
        if (target?.isConnected) focusElement(target);
        setTarget(null);
      }}>
      <div className="grid gap-3">
        <h2 className="text-lg font-semibold">{target?.dataset.posterTitle}</h2>
        {play && <Link className={button} href={play} onClick={() => dialog.current?.close()}>
          {play.startsWith("/watch/") ? "Play" : "Open show"}
        </Link>}
        <button className={button} type="button" disabled={busy} onClick={() => void act("favourite")}>Add to My List</button>
        <button className={button} type="button" disabled={busy} onClick={() => void act("watched")}>Mark Watched</button>
        {target?.dataset.posterResume && (
          <button className={button} type="button" disabled={busy} onClick={() => void act("remove-resume")}>Remove from Continue Watching</button>
        )}
        {genres.length > 1 && (
          <button className={button} type="button" aria-expanded={showGenres}
            onClick={() => setShowGenres((open) => !open)}>Primary Genre</button>
        )}
        {showGenres && posterId && (
          <>
            <button className={button} type="button" aria-pressed={!readGenreOverride(posterId)}
              onClick={() => changeGenre(null)}>Automatic</button>
            {genres.map((genre) => (
              <button key={genre} className={button} type="button"
                aria-pressed={genre === readGenreOverride(posterId)}
                onClick={() => changeGenre(genre)}>{genre}</button>
            ))}
          </>
        )}
        {status && <p role="status">{status}</p>}
        <button className={button} type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
