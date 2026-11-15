# How Prometheus works

Prometheus is a TV-oriented frontend for an existing Jellyfin server. Jellyfin supplies the library, artwork, accounts, playback sources and watch progress. The Prometheus web app presents that library in a layout designed for a TV remote. The Fire TV app opens your Prometheus web app in an Android WebView.

## What runs where

| Component | Location | Role |
| --- | --- | --- |
| Web app | `prometheus/` | Next.js interface and server routes for sign-in, browsing, artwork and playback |
| Fire TV app | `prometheus-firetv/` | Fullscreen WebView pointed at your Prometheus HTTPS address, with Fire TV remote handling |
| Jellyfin | Your own Jellyfin server | Scans and manages media, authenticates users, serves streams and transcodes when needed |

A Fire TV talks to Prometheus. The Prometheus server talks to Jellyfin using the signed-in user's Jellyfin session. When the web app is updated at the same address, the Fire TV app picks up the update when it reloads.

## Browsing your library

| Screen | What it does |
| --- | --- |
| **Home** | Featured film or series, Continue Watching, recommendations and recently added titles |
| **Films** and **Series** | Separate featured titles, recommendations and horizontal genre rows. Focus a card to expand it and preview a trailer when available. |
| **Browse All** | Continuous catalogue with five titles per full row, sorting, genre filtering and an A–Z filter for title order |
| **My List** | Continue Watching followed by saved titles from your Jellyfin favourites |
| **Search** | On-screen keyboard and genre shortcuts on the left. Films and series appear together in a four-column poster grid that updates as you type. A physical keyboard can also type directly into the search box. |

Recommendations use Jellyfin favourites, watched titles and recent playback to give more weight to genres you engage with. The featured title rotates among candidates and avoids the previous pick when another candidate is available. Genre browsing assigns each title one primary genre. Untagged titles appear under **Uncategorised**.

Local trailers and supported YouTube links come from Jellyfin's title metadata. Playback of a YouTube preview depends on embeddability and device autoplay settings. On TV, use the directional pad to move focus, Select to open a title or action, and Back to return. Prometheus restores the selected poster after returning from a title or playback when it can find that poster in the current view.

## What happens when you press Play

1. Prometheus checks the session and asks Jellyfin for playback information.
2. Compatible media can stream directly. Jellyfin can supply an HLS stream when transcoding is needed.
3. The player reports progress to Jellyfin so an unfinished title can appear in Continue Watching and resume from its saved position.
4. If Jellyfin provides them for the title and playback mode, the player can use audio and subtitle tracks, intro markers and a next episode.

Use the timeline to seek. On the TV remote, Left and Right can seek during playback or move between controls when those controls are open. Play/Pause toggles playback, and Back closes the open controls before leaving the player.

## Run the web app locally

You need a reachable Jellyfin server, a Jellyfin account, Node.js 24, npm and OpenSSL. From the root of this repository, run the following in Bash. Replace the example Jellyfin URL with the origin that your web server can reach.

```bash
cd prometheus
npm ci

umask 077
state="${XDG_STATE_HOME:-$HOME/.local/state}/prometheus"
mkdir -p "$state"
for name in token-key rate-limit-secret; do
  if [[ ! -s "$state/$name" ]]; then
    openssl rand -hex 32 > "$state/$name"
  fi
done

export JELLYFIN_SERVER_URL="https://jellyfin.example.com"
export PROMETHEUS_PUBLIC_URL="http://127.0.0.1:3000"
export PROMETHEUS_ALLOWED_ORIGINS="$PROMETHEUS_PUBLIC_URL"
export PROMETHEUS_SESSION_DB_PATH="$state/sessions.sqlite"
export PROMETHEUS_TOKEN_ENCRYPTION_KEY="$(cat "$state/token-key")"
export PROMETHEUS_RATE_LIMIT_SECRET="$(cat "$state/rate-limit-secret")"

npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open [local Prometheus](http://127.0.0.1:3000) and sign in with your Jellyfin username and password. Use the same address as the configured allowed origin. In development, `localhost` and `127.0.0.1` are different origins.

### Production configuration

The web app can be built with `npm run build` and served with `npm run start`. The web directory also contains a Dockerfile. In production, serve the app over HTTPS and provide the following settings to the running process.

| Variable | Value |
| --- | --- |
| `JELLYFIN_SERVER_URL` | Jellyfin origin reachable from Prometheus, including the port if needed |
| `PROMETHEUS_PUBLIC_URL` | Canonical browser-facing Prometheus origin |
| `PROMETHEUS_ALLOWED_ORIGINS` | Comma-separated list of allowed Prometheus origins. If unset, the public URL is used. Include the exact HTTPS origin used by Fire TV. |
| `PROMETHEUS_SESSION_DB_PATH` | Persistent SQLite file in a directory writable by the process. Mount that directory as a volume when running in Docker. |
| `PROMETHEUS_TOKEN_ENCRYPTION_KEY` | Persistent 32-byte random key encoded as 64 hexadecimal characters |
| `PROMETHEUS_RATE_LIMIT_SECRET` | Separate 32-byte random secret encoded as 64 hexadecimal characters |

Use full origins with a scheme and host, plus a port where required. Serve Prometheus at the root of its origin. Keep the session database and secrets outside Git. Prometheus encrypts Jellyfin session tokens stored in its local SQLite database and uses secure session cookies in production.

## Build for Fire TV

Install JDK 17 and Android SDK Platform 36. Make the SDK available to Gradle through your local Android tooling. From the repository root:

```bash
cd prometheus-firetv
bash ./gradlew assembleDebug \
  -PprometheusServerUrl=https://prometheus.example.com/
```

Substitute your own HTTPS origin. The device must be able to reach it and trust its certificate. The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. With ADB connected to your Fire TV, identify the device using `adb devices -l`, then install:

```bash
adb -s YOUR_DEVICE_SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
```

Open Prometheus from the Fire TV app list and sign in with your Jellyfin account.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Fire TV cannot load the app | Verify the APK was built for the correct origin and check device DNS, network reachability and certificate trust. |
| Sign-in fails | Try the credentials in Jellyfin Web, verify Prometheus can reach Jellyfin, and check that the browser or Fire TV origin is allowed. |
| Posters or library are empty | Check that the Jellyfin account can access the library and that Jellyfin has finished scanning it. |
| A single title fails to play | Try it in Jellyfin Web and check whether Jellyfin can direct-play or transcode it for the device. |
| A trailer stays on its artwork | Check for a local trailer or an embeddable YouTube trailer attached to the title in Jellyfin. |
