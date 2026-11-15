import Image from "next/image";
import Link from "next/link";

export default function PrometheusHeader({ home = false, tab }: { home?: boolean; tab?: "movies" | "series" | "my-list" | "search" }) {
  if (home || tab) {
    return (
      <header className="prometheus-header prometheus-netflix-home-header">
        <Image src="/profile-avatars/avatar-01.webp" alt="Profile" width={40} height={40}
          className="prometheus-home-avatar" />
        <nav className="prometheus-nav" aria-label="Main navigation">
          <Link href="/search" aria-label="Search" aria-current={tab === "search" ? "page" : undefined}><span className="prometheus-home-search" aria-hidden="true" /></Link>
          <Link href="/" aria-current={!tab ? "page" : undefined}>Home</Link>
          <Link href="/series" aria-current={tab === "series" ? "page" : undefined}>Series</Link>
          <Link href="/movies" aria-current={tab === "movies" ? "page" : undefined}>Films</Link>
          <Link href="/my-list" aria-current={tab === "my-list" ? "page" : undefined}>My List</Link>
        </nav>
        <Image src="/prometheus-logo.svg" alt="Prometheus" width={900} height={270}
          className="prometheus-home-mark h-auto w-[clamp(3.75rem,10vw,8.5rem)]" />
      </header>
    );
  }

  return (
    <header className="prometheus-header">
      <div className="prometheus-brand">
        <Image
          src="/prometheus-logo.svg"
          alt="Prometheus"
          width={900}
          height={270}
          priority
          className="prometheus-brand-image"
        />
      </div>
      <nav className="prometheus-nav" aria-label="Main navigation">
        <Link href="/">Home</Link>
        <Link href="/movies">Movies</Link>
        <Link href="/series">TV Shows</Link>
        <Link href="/search">Search</Link>
        <Link href="/my-list">My List</Link>
      </nav>
    </header>
  );
}
