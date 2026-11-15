"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { focusElement } from "@/components/prometheus-remote-navigation";

export default function PrimaryPlaybackLink({ id, label, favouriteId }: { id: string; label: string; favouriteId?: string }) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (ref.current) focusElement(ref.current);
  }, []);

  return (
    <>
    <Link
      ref={ref}
      data-primary-playback
      data-favourite-id={favouriteId}
      data-poster-id={id} data-poster-title={label}
      data-poster-play={`/watch/${encodeURIComponent(id)}`}
      data-poster-resume={label.startsWith("Resume") ? "true" : undefined}
      href={`/watch/${encodeURIComponent(id)}`}
      className="inline-flex min-h-12 items-center rounded-lg bg-[#c9ad7c] px-6 py-3 font-semibold text-black hover:bg-[#ddc696] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
    >
      {label}
    </Link>
    <button type="button"
      className="ml-3 rounded-lg border border-white/30 px-5 py-3 focus-visible:outline-2"
      onClick={() => ref.current?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))}>
      Title Actions
    </button>
    </>
  );
}
