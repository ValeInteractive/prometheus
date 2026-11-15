import Image from "next/image";
import Link from "next/link";

export default function ProfilesPage() {
  return (
    <main className="profiles-page">
      <header className="profiles-header">
        <Link href="/" aria-label="Prometheus Home">
          <Image src="/prometheus-logo.svg" alt="Prometheus" width={180} height={60} priority />
        </Link>
      </header>
      <section className="profiles-content">
        <h1>Who&apos;s Watching?</h1>
        <p className="profiles-description">Your personal PROMETHEUS profile.</p>
        <div className="prometheus-profile-panel">
          <div className="prometheus-profile-card">
            <div className="prometheus-profile-picture">
              <Image src="/profile-avatars/avatar-01.webp" alt="My Profile" width={160} height={160} unoptimized priority />
            </div>
            <span className="profile-name">My Profile</span>
          </div>
          <div className="prometheus-profile-actions">
            <Link href="/" className="prometheus-profile-primary">Continue Watching</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
