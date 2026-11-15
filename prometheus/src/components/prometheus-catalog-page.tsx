import { Suspense } from "react";
import PrometheusHeader from "@/components/prometheus-header";
import LibraryRows from "@/components/library-rows";
import "./prometheus-home-rails.css";

export default function PrometheusCatalogPage({
  category,
}: {
  category: "movies" | "series";
}) {
  return (
    <div className="prometheus-home-page">
      <PrometheusHeader tab={category} />
      <main className="prometheus-content prometheus-catalogue-grid space-y-5">
        <h1 className="text-2xl font-bold">
          {category === "movies" ? "Browse Films" : "Browse Series"}
        </h1>
        <Suspense fallback={<p role="status">Loading catalogue…</p>}>
          <LibraryRows category={category} />
        </Suspense>
      </main>
    </div>
  );
}
