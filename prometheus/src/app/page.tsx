import PrometheusHeader from "@/components/prometheus-header";
import ContinueWatchingRow from "@/components/continue-watching-row";
import PrometheusLaunchIntro from "@/components/prometheus-launch-intro";

export default function Home() {
  return (
    <>
      <PrometheusLaunchIntro />
      <div className="prometheus-home-page">
        <PrometheusHeader home />
        <main id="home">
          <div className="prometheus-content">
            <ContinueWatchingRow />
          </div>
        </main>
        <footer className="prometheus-footer">
          PROMETHEUS · Your personal media library
        </footer>
      </div>
    </>
  );
}
