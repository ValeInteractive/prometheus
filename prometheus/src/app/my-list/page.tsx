import { Suspense } from "react";
import PrometheusHeader from "@/components/prometheus-header";
import PrometheusLibraryBrowser from "@/components/prometheus-library-browser";
import ContinueWatchingRow from "@/components/continue-watching-row";

async function TabContent({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  if ((await searchParams).view === "all") {
    return (
      <div className="prometheus-home-page prometheus-my-list-page">
        <PrometheusHeader tab="my-list" />
        <main className="prometheus-content">
          <h1 className="prometheus-list-heading">My List</h1>
          <PrometheusLibraryBrowser mode="favourites" />
        </main>
      </div>
    );
  }

  return (
    <div className="prometheus-home-page prometheus-my-list-page">
      <PrometheusHeader tab="my-list" />
      <main className="prometheus-content">
        <ContinueWatchingRow tab="my-list" />
        <PrometheusLibraryBrowser mode="favourites" rail />
      </main>
    </div>
  );
}

export default function Page({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  return (
    <Suspense fallback={<p role="status">Loading titles…</p>}>
      <TabContent searchParams={searchParams} />
    </Suspense>
  );
}
