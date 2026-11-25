import PosterActions from "@/components/poster-actions";
import { Suspense } from "react";
import PrometheusRemoteNavigation from "@/components/prometheus-remote-navigation";
import type { Metadata } from "next";
import "./globals.css";
import "./firetv-navigation.css";
import "./page-layout.css";

export const metadata: Metadata = {
  title: "Prometheus",
  description: "A private cinema, made for home.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <PrometheusRemoteNavigation />
        </Suspense>
        <PosterActions />
        {children}
      </body>
    </html>
  );
}
