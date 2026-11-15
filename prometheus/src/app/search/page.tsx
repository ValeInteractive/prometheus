import PrometheusHeader from "@/components/prometheus-header";
import PrometheusTvSearch from "@/components/prometheus-tv-search";
import "@/components/prometheus-home-rails.css";

export default function Page() {
  return (
    <div className="prometheus-home-page">
      <PrometheusHeader tab="search" />
      <main className="prometheus-content">
        <PrometheusTvSearch />
      </main>
    </div>
  );
}
