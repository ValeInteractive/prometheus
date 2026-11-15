"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Direction =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

const SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "video[tabindex]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function isEditable(
  element: Element | null,
): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable="true"]',
    ),
  );
}

function isPlayer(
  element: Element | null,
): boolean {
  return Boolean(element?.closest("video, .prometheus-video-shell"));
}

function visible(
  element: HTMLElement,
): boolean {
  if (
    element.matches(
      ":disabled, [aria-disabled='true']",
    ) ||
    element.closest(
      "[inert], [hidden], [aria-hidden='true']",
    )
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);

  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    style.pointerEvents === "none"
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return rect.width > 0 && rect.height > 0;
}

function candidates(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      SELECTOR,
    ),
  ).filter(visible);
}

function center(
  element: HTMLElement,
) {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

const POSTER_GRID_SELECTOR = ".prometheus-card-grid, .prometheus-search-poster-grid";
const ROW_SELECTOR = `${POSTER_GRID_SELECTOR}, .prometheus-season-rail, .prometheus-home-rail`;
const GRID_CARD_SELECTOR = ".prometheus-card, .prometheus-search-poster-grid > li";

function nearestInAdjacentRow(current: HTMLElement, direction: Direction, elements: HTMLElement[]) {
  const row = current.closest(ROW_SELECTOR);
  if (!row || (direction !== "ArrowUp" && direction !== "ArrowDown")) return null;
  const step = direction === "ArrowDown" ? 1 : -1;
  const currentCard = current.closest(GRID_CARD_SELECTOR);
  if (row.matches(POSTER_GRID_SELECTOR) && currentCard) {
    const bounds = currentCard.getBoundingClientRect();
    const candidates = elements.flatMap((element) => {
      if (element.closest(ROW_SELECTOR) !== row) return [];
      const card = element.closest(GRID_CARD_SELECTOR);
      if (!card || card === currentCard) return [];
      const rect = card.getBoundingClientRect();
      const distance = step * (rect.top - bounds.top);
      return distance > 8 ? [{ element, distance, column: Math.abs(rect.left - bounds.left) }] : [];
    });
    candidates.sort((a, b) => a.distance - b.distance || a.column - b.column);
    if (candidates[0]) return candidates[0].element;
  }

  const rows = Array.from(document.querySelectorAll(ROW_SELECTOR));
  const adjacent = rows[rows.indexOf(row) + step];
  if (!adjacent) return null;

  const x = center(current).x;
  const choices = elements.filter((element) => element.closest(ROW_SELECTOR) === adjacent);
  return choices.reduce<HTMLElement | null>((best, element) =>
    !best || Math.abs(center(element).x - x) < Math.abs(center(best).x - x) ? element : best,
  null);
}

const focusLinkSelector = "a[data-poster-id][href], a[data-genre-tile][href]";
const playbackOriginKey = "prometheus:playback-origin";

interface FocusSnapshot {
  posterId?: string;
  href: string;
  rowId: string | null;
  rowScroll: number;
  pageScroll: number;
}

function saveFocus(element: Element, snapshots: Map<string, FocusSnapshot>, pathname: string) {
  const link = element.closest<HTMLAnchorElement>(focusLinkSelector);
  if (!link) return;
  const row = link.closest(ROW_SELECTOR);
  const query = new URLSearchParams(window.location.search).toString();
  const key = pathname + (query ? "?" + query : "");
  const snapshot = {
    posterId: link.dataset.posterId,
    href: link.getAttribute("href")!,
    rowId: row?.closest("section[id]")?.id ?? null,
    rowScroll: row?.scrollLeft ?? 0,
    pageScroll: window.scrollY,
  };
  snapshots.set(key, snapshot);
  try {
    sessionStorage.setItem("prometheus:poster-focus:" + key, JSON.stringify(snapshot));
  } catch {
    // In-memory restoration still works during client-side navigation.
  }
}

function bestNext(
  current: HTMLElement,
  direction: Direction,
  elements: HTMLElement[],
): HTMLElement | null {
  if (direction === "ArrowDown" && current.closest(".prometheus-nav")) {
    const start = center(current);
    const controls = elements.filter((element) =>
      element.closest("main") &&
      !element.closest(`.prometheus-header, ${ROW_SELECTOR}`) &&
      center(element).y > start.y + 4,
    );
    if (controls.length) {
      const firstControlRow = Math.min(...controls.map((element) => center(element).y));
      const closest = controls
        .filter((element) => center(element).y <= firstControlRow + 16)
        .sort((a, b) => Math.abs(center(a).x - start.x) - Math.abs(center(b).x - start.x))[0];
      if (closest) return closest;
    }
  }

  const homeRail = current.closest(".prometheus-home-rail");
  if (homeRail && (direction === "ArrowLeft" || direction === "ArrowRight")) {
    const step = direction === "ArrowRight" ? 1 : -1;
    const activeCard = current.closest(".prometheus-card");
    const cards = Array.from(homeRail.children);
    const nextCard = activeCard && cards[cards.indexOf(activeCard) + step];
    return elements.find((element) => nextCard && nextCard.contains(element) &&
      element.matches("[data-poster-id]")) ?? null;
  }

  const adjacent = nearestInAdjacentRow(current, direction, elements);
  if (adjacent) return adjacent;
  const start = center(current);

  let selected: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of elements) {
    if (candidate === current) continue;

    const end = center(candidate);

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const primary =
      direction === "ArrowRight"
        ? dx
        : direction === "ArrowLeft"
          ? -dx
          : direction === "ArrowDown"
            ? dy
            : -dy;

    if (primary <= 4) continue;

    const secondary =
      direction === "ArrowLeft" ||
      direction === "ArrowRight"
        ? Math.abs(dy)
        : Math.abs(dx);

    // Prefer controls in the same row or column.
    // Still permit moving between different rows.
    const score =
      primary +
      secondary * 2.5 +
      Math.hypot(primary, secondary) * 0.1;

    if (score < bestScore) {
      bestScore = score;
      selected = candidate;
    }
  }

  return selected;
}

export function focusElement(
  element: HTMLElement,
  scroll = true,
): void {

  element.focus({
    preventScroll: true,
  });

  if (!scroll) return;
  const rail = element.closest<HTMLElement>(".prometheus-home-rail");
  const card = element.closest<HTMLElement>(".prometheus-card");
  if (rail && card) {
    const section = rail.closest("section");
    rail.scrollLeft += card.getBoundingClientRect().left - rail.getBoundingClientRect().left - rail.clientLeft - 4;
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  element.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest",
  });
}

function firstFocusTarget(
  elements: HTMLElement[],
): HTMLElement | null {
  const preferredSelectors = [
    "[data-tv-search-start]",
    "[data-primary-playback]",
    ".prometheus-actions a[href]",
    ".prometheus-card-grid a[href]",
    "main a[href]",
    "main button:not([disabled])",
  ];

  for (const selector of preferredSelectors) {
    const preferred = document.querySelector<HTMLElement>(selector);

    if (preferred && elements.includes(preferred)) {
      return preferred;
    }
  }

  return (
    elements.find((element) => element.closest("main")) ??
    elements[0] ??
    null
  );
}

function goBack(router: ReturnType<typeof useRouter>): void {
  const pathname = window.location.pathname;

  const referrer = document.referrer;

  if (referrer && window.history.length > 1) {
    try {
      const previous = new URL(referrer);

      if (
        previous.origin === window.location.origin
      ) {
        window.history.back();
        return;
      }
    } catch {
      // Use the local fallback below.
    }
  }

  if (pathname.startsWith("/series/")) {
    router.push("/series");
    return;
  }

  if (pathname.startsWith("/movie/")) {
    router.push("/movies");
    return;
  }

  if (pathname !== "/") {
    router.push("/");
  }
}

export default function PrometheusRemoteNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const snapshots = useRef(new Map<string, FocusSnapshot>());
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    function onHistoryReturn() {
      const query = new URLSearchParams(window.location.search).toString();
      returnTo.current = window.location.pathname + (query ? "?" + query : "");
    }
    window.addEventListener("popstate", onHistoryReturn);
    return () => window.removeEventListener("popstate", onHistoryReturn);
  }, []);

  useEffect(() => {
    function remember(event: Event) {
      if (!(event.target instanceof Element)) return;
      const poster = event.target.closest<HTMLAnchorElement>(focusLinkSelector) ??
        event.target.closest(".prometheus-movie-card")?.querySelector<HTMLAnchorElement>("a[data-poster-id][href]");
      if (!poster) return;
      saveFocus(poster, snapshots.current, pathname);
      const href = poster.getAttribute("href");
      if (event.type === "click" && href?.startsWith("/watch/")) {
        try {
          sessionStorage.setItem(playbackOriginKey, JSON.stringify({
            origin: pathname + window.location.search,
            playback: href,
          }));
        } catch {
          // The existing history restoration can still use memory.
        }
      }
    }
    document.addEventListener("focusin", remember);
    document.addEventListener("click", remember, true);
    return () => {
      document.removeEventListener("focusin", remember);
      document.removeEventListener("click", remember, true);
    };
  }, [pathname]);

  useEffect(() => {
    let initialized = false;
    const key = pathname + (search ? "?" + search : "");
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    let explicitReturn = false;
    try {
      const pending = sessionStorage.getItem(playbackOriginKey + ":return");
      explicitReturn = pending === key;
      if (pending !== null) sessionStorage.removeItem(playbackOriginKey + ":return");
    } catch {
      // Fall back to the browser history signal.
    }
    const returning = explicitReturn || returnTo.current === key ||
      (returnTo.current === null && navigation?.type === "back_forward" && window.location.href === navigation.name);
    let snapshot = returning ? snapshots.current.get(key) : undefined;
    if (returning && !snapshot) {
      try {
        const stored = sessionStorage.getItem("prometheus:poster-focus:" + key);
        if (stored) snapshot = JSON.parse(stored) as FocusSnapshot;
      } catch {
        // The normal focus target is available when storage cannot be read.
      }
    }
    returnTo.current = null;
    let waitingToRestore = Boolean(snapshot);

    function initializeFocus(): boolean {
      if (initialized) return true;
      if (document.querySelector("[data-catalogue-loading]")) return false;

      if (waitingToRestore && snapshot) {
        const row = snapshot.rowId ? document.getElementById(snapshot.rowId) : null;
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(focusLinkSelector));
        const matches = links.filter((link) => visible(link) &&
          ((snapshot.posterId && link.dataset.posterId === snapshot.posterId) || link.getAttribute("href") === snapshot.href));
        const saved = matches.find((link) => row?.contains(link)) ?? matches[0];
        if (!saved) return false;
        const sameRow = Boolean(row?.contains(saved)) || !snapshot.rowId;
        initialized = true;
        focusElement(saved, !sameRow);
        if (sameRow) {
          const rail = saved.closest(ROW_SELECTOR);
          if (rail) rail.scrollLeft = snapshot.rowScroll;
          window.scrollTo(0, snapshot.pageScroll);
        }
        initialized = true;
        return true;
      }

      const active = document.activeElement;
      const elements = candidates();
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        active !== document.documentElement
      ) {
        if (elements.includes(active)) {
          focusElement(active);
        }
        initialized = true;
        return true;
      }

      const first = firstFocusTarget(elements);
      if (!first) return false;

      focusElement(first);
      initialized = true;
      return true;
    }

    const observer = new MutationObserver(() => {
      if (initializeFocus()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const frame = window.requestAnimationFrame(() => {
      initializeFocus();
      if (initialized) observer.disconnect();
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      waitingToRestore = false;
      initializeFocus();
    }, 8000);

    function handleKey(
      event: KeyboardEvent,
    ) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      if (waitingToRestore && event.key.startsWith("Arrow")) {
        waitingToRestore = false;
        observer.disconnect();
      }

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      // Unhandled Fire Stick Back reaches this listener before native goBack.
      if ((event.key === "BrowserBack" || event.key === "Escape") && pathname.startsWith("/watch/")) {
        try {
          const origin = JSON.parse(sessionStorage.getItem(playbackOriginKey) ?? "null");
          if (origin?.playback === pathname && typeof origin.origin === "string") {
            sessionStorage.setItem(playbackOriginKey + ":return", origin.origin);
            returnTo.current = origin.origin;
            if (event.key === "Escape") {
              event.preventDefault();
              window.history.back();
            }
            return;
          }
        } catch {
          // Keep the existing Back handling when there is no saved origin.
        }
      }

      // The video player has its own remote controls.
      if (
        event.key !== "Escape" && (isPlayer(target) || isPlayer(active))
      ) {
        return;
      }

      // Never override typing or form interaction.
      if (
        isEditable(target) ||
        isEditable(active)
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (
          window.location.pathname !== "/"
        ) {
          event.preventDefault();
          goBack(router);
        }
        return;
      }

      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        // Native Enter and Space already activate links
        // and buttons. Preserve that behaviour.
        return;
      }

      const elements = candidates();

      if (elements.length === 0) {
        return;
      }

      if (
        !active ||
        !elements.includes(active)
      ) {
        const first = firstFocusTarget(elements);
        if (first) {
          event.preventDefault();
          focusElement(first);
        }
        return;
      }

      const next = bestNext(
        active,
        event.key,
        elements,
      );

      if (next) {
        event.preventDefault();
        focusElement(next);
      }
    }

    window.addEventListener(
      "keydown",
      handleKey,
    );

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener(
        "keydown",
        handleKey,
      );
    };
  }, [pathname, router, search]);

  return null;
}
