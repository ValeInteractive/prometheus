import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  readSessionCookie,
} from "@/lib/auth/session-cookies";

import {
  getAuthenticatedSession,
} from "@/lib/auth/session-service";

interface ProfilesLayoutProps {
  children: ReactNode;
}

async function AuthenticatedProfiles({
  children,
}: ProfilesLayoutProps) {
  await connection();
  const token = await readSessionCookie();

  if (!token) {
    redirect("/login");
  }

  const session = getAuthenticatedSession(token);

  if (!session) {
    redirect("/login");
  }

  return <>{children}</>;
}

export default function ProfilesLayout({
  children,
}: ProfilesLayoutProps) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#090909] text-white">
          <p
            role="status"
            className="text-sm text-neutral-400"
          >
            Loading Prometheus...
          </p>
        </main>
      }
    >
      <AuthenticatedProfiles>
        {children}
      </AuthenticatedProfiles>
    </Suspense>
  );
}
