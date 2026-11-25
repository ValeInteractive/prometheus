"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationTab = "movies" | "series" | "my-list" | "search";

export default function PrometheusHeader({ tab }: { home?: boolean; tab?: NavigationTab }) {
  const pathname = usePathname();
  const selected = tab ?? (
    pathname.startsWith("/series") ? "series" :
    pathname.startsWith("/movie") || pathname.startsWith("/collections") ? "movies" :
    pathname.startsWith("/my-list") ? "my-list" :
    pathname.startsWith("/search") ? "search" : null
  );

  return (
    <header className="prometheus-header prometheus-netflix-home-header prometheus-shared-header">
      <Image src="/profile-avatars/avatar-01.webp" alt="Profile" width={40} height={40}
        className="prometheus-home-avatar" />
      <nav className="prometheus-nav" aria-label="Main navigation">
        <Link href="/search" aria-label="Search" aria-current={selected === "search" ? "page" : undefined}>
          <span className="prometheus-home-search" aria-hidden="true" />
        </Link>
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Home</Link>
        <Link href="/series" aria-current={selected === "series" ? "page" : undefined}>Series</Link>
        <Link href="/movies" aria-current={selected === "movies" ? "page" : undefined}>Films</Link>
        <Link href="/my-list" aria-current={selected === "my-list" ? "page" : undefined}>My List</Link>
      </nav>
      <Image src="/prometheus-logo.svg" alt="Prometheus" width={900} height={270}
        className="prometheus-home-mark h-auto w-[clamp(3.75rem,10vw,8.5rem)]" />
    </header>
  );
}
