import { Suspense } from "react";
import PrometheusHeader from "@/components/prometheus-header";
import PrometheusLibraryBrowser from "@/components/prometheus-library-browser";
import ContinueWatchingRow from "@/components/continue-watching-row";

async function TabContent({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  if ((await searchParams).view === "all") {
    return (
      <>
        <PrometheusHeader tab="my-list" />
        <main>
          <section className="prometheus-catalog-hero"><h1>My List</h1></section>
          <PrometheusLibraryBrowser mode="favourites" />
        </main>
      </>
    );
  }

  return (
    <div className="prometheus-home-page">
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
