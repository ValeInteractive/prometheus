"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          setError(
            "Too many login attempts. Please try again later.",
          );
        } else if (response.status === 401) {
          setError(
            "Login failed. Check your Jellyfin credentials.",
          );
        } else if (response.status === 503) {
          setError(
            "Authentication is temporarily unavailable.",
          );
        } else {
          setError(
            "Unable to sign in. Please try again.",
          );
        }

        return;
      }

      setPassword("");

      router.replace("/profiles");
      router.refresh();
    } catch {
      setError(
        "Unable to connect. Please check your connection.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="prometheus-login-page flex min-h-screen items-center justify-center bg-[#090909] px-5 py-12 text-white">
      <div className="w-full max-w-md">
        <div className="mb-10 flex justify-center">
          <Link href="/" aria-label="Prometheus homepage">
            <Image
              src="/prometheus-logo.svg"
              alt="Prometheus"
              width={360}
              height={120}
              priority
              className="h-auto w-64 object-contain sm:w-72"
            />
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-[#151515] p-7 shadow-2xl sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight">
            Sign In
          </h1>

          <p className="mt-3 text-sm text-neutral-400">
            Sign in using your Jellyfin account.
          </p>

          <form
            onSubmit={handleSubmit}
            aria-busy={loading}
            className="mt-8 space-y-5"
          >
            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-sm font-medium"
              >
                Username
              </label>

              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={128}
                required
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                disabled={loading}
                className="w-full rounded-lg border border-white/15 bg-[#262626] px-4 py-3 text-base text-white outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/40 disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium"
              >
                Password
              </label>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                disabled={loading}
                className="w-full rounded-lg border border-white/15 bg-[#262626] px-4 py-3 text-base text-white outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/40 disabled:opacity-60"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full cursor-pointer rounded-lg bg-[#e50914] px-5 py-3.5 text-base font-semibold text-white transition hover:bg-[#f6121d] focus:outline-none focus:ring-4 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="mt-7 text-center text-xs text-neutral-500">
            Your media. Your home. PROMETHEUS.
          </p>
        </section>
      </div>
    </main>
  );
}
