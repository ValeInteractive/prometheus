import { Suspense } from "react";
import PrometheusCatalogPage from "@/components/prometheus-catalog-page";
import PrometheusHeader from "@/components/prometheus-header";
import ContinueWatchingRow from "@/components/continue-watching-row";

async function TabContent({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (Object.keys(params).length > 0) return <PrometheusCatalogPage category="movies" />;

  return (
    <div className="prometheus-home-page">
      <PrometheusHeader tab="movies" />
      <main className="prometheus-content">
        <ContinueWatchingRow tab="movies" />
      </main>
    </div>
  );
}

export default function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<p role="status">Loading titles…</p>}>
      <TabContent searchParams={searchParams} />
    </Suspense>
  );
}
