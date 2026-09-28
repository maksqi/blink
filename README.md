# blinq

Self-hosted, end-to-end encrypted video meetings for teams. blinq runs meetings of up to 25 people with encrypted
audio, video, screen share and chat on one Linux server, started with one `docker compose up`. The stack is a Nuxt web
app and API, a LiveKit SFU with built-in TURN, PostgreSQL, and Caddy for automatic HTTPS. The room key travels only in
the meeting link's fragment (`#k=…`), which browsers never send to a server. So neither the media server nor the
database ever sees your calls or chat in plaintext.

**Status:** Under development — see [docs/ROADMAP.md](docs/ROADMAP.md).

## Features

- **End-to-end encryption** for media and chat (LiveKit E2EE and AES-GCM). The key exists only in the link fragment
  and in participants' browsers, never on the server. A safety code lets participants check that they share one key.
- **Rooms of up to 25 people** with grid and speaker views, pinning, and an active-speaker highlight.
- **Host controls:**
  - a waiting room (admit or deny), locking the room, and removing a participant;
  - muting microphones and turning off cameras;
  - giving voice (letting a participant with a raised hand speak);
  - setting a participant's volume for everyone;
  - co-hosts.
- **Screen share** at 720p–1080p and 5–30 fps (the admin sets the maximum), with optional tab or system audio.
- **Chat, reactions and raised hands.**
- **Background blur and noise suppression** (RNNoise), both processed in the browser.
- **Recording in the browser**, in one of two modes:
  - uploaded and stored encrypted on the server (the server and admins can decrypt it);
  - saved only on the recording device, which keeps it end-to-end encrypted.
- **Admin panel:** users, account invites, registration mode, guests, media quality and limits, recordings and
  retention, the audit log, an SMTP test.
- **Invite-only accounts** by default (open or domain-restricted registration are options), plus **guests** who join
  from a room invite link without an account.
- **Dark and light theme** (follows the system), a **responsive** layout down to phones, and keyboard shortcuts,
  including push-to-talk.
- **Self-hosted:** one `docker compose up`, automatic HTTPS, and TURN over TLS on port 443 for restrictive networks.
  No third-party services, CDNs or telemetry.

## Requirements

- A Linux server (x86_64 or arm64) with Docker Engine ≥ 28.0.1 and the Compose plugin. Production uses host
  networking, so Docker Desktop on macOS or Windows is not supported for production.
- A public IPv4 address. 1:1 NAT (common on cloud VMs) works with one extra UDP range (see [Ports](#ports)). Set
  `LIVEKIT_NODE_IP` to the public address.
- DNS names that point at the server: `DOMAIN` for blinq, and `TURN_DOMAIN` (recommended) for TURN over TLS.
- The public ports below, open in the host firewall and in any cloud security group.
- Sizing: these are estimates until they are measured, see [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

  | Use | vCPU | RAM | Bandwidth |
  |---|---|---|---|
  | Small team | 2 | 4 GB | 100 Mbit/s |
  | Full 25-person meetings | 4+ | 8 GB | ≥ 500 Mbit/s – 1 Gbit/s |
  | Recordings | — | — | ≈ 1–1.8 GB of disk per recording hour at 1080p |

- Optional: an SMTP server for emailed account invites, email verification and password reset. The server never
  emails room links, because they contain the key.
- TLS, one of three modes:
  - Let's Encrypt (`TLS_MODE=acme`), which needs ports 80 and 443 reachable from the internet;
  - Caddy's internal CA for LAN installs (`internal`);
  - your own certificate files (`files`).

## Quick start

> TODO(stage-09a): the `infra` agent completes this section (exact commands, `scripts/preflight.sh`, expected output)
> and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

1. **DNS.** Create A records (and AAAA, if you have IPv6) for `DOMAIN` and `TURN_DOMAIN` that point at the server.
2. **Firewall.** Open the public ports from the table below.
3. **Get the code and configure it:**
   ```sh
   git clone https://github.com/maksqi/blinq.git
   cd blinq
   sh scripts/init-env.sh        # writes .env with generated secrets
   # or: cp .env.example .env    # and fill in every REQUIRED value by hand
   chmod 600 .env
   ```
   Check `DOMAIN`, `TURN_DOMAIN`, `TLS_MODE`, `ACME_EMAIL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Values that
   still look like placeholders (`change-me…`) are refused at startup.
4. **Start:**
   ```sh
   docker compose up -d --wait
   ```
5. **First login.** Open `https://DOMAIN` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. You must choose a new
   password. Then **remove `ADMIN_PASSWORD`** (and `ADMIN_EMAIL`) from `.env`; they are never used again.
6. **Invite people** from Admin → Invites, or change the registration mode in Admin → Settings.
7. **Back up `.env`**, above all `RECORDING_ENCRYPTION_KEY`. Without it, stored recordings cannot be decrypted.

## Ports

Public (open these in the firewall):

| Port | Protocol | Used by | Purpose | `.env` |
|---|---|---|---|---|
| 80 | TCP | Caddy | ACME HTTP-01 challenges, redirect to HTTPS | — |
| 443 | TCP | Caddy | HTTPS, WebSocket signaling (`/rtc`), TURN over TLS (routed by SNI on `TURN_DOMAIN`) | — |
| 443 | UDP | Caddy | HTTP/3 | — |
| 3478 | UDP | LiveKit | TURN over UDP | `LIVEKIT_TURN_UDP_PORT` |
| 7881 | TCP | LiveKit | ICE over TCP (media when UDP is blocked) | `LIVEKIT_RTC_TCP_PORT` |
| 50000–60000 | UDP | LiveKit | WebRTC media | `LIVEKIT_RTC_PORT_RANGE_START`, `LIVEKIT_RTC_PORT_RANGE_END` |
| 30000–40000 | UDP | LiveKit TURN | only on clouds with 1:1 NAT: TURN relay hairpin | — |

Not public (loopback or socket only; keep them closed):

| Port | Used by | Notes | `.env` |
|---|---|---|---|
| 3000/tcp | blinq app | bound to 127.0.0.1; Caddy is the only way in | `APP_PORT` |
| 7880/tcp | LiveKit API | bound to 127.0.0.1; Caddy proxies only `/rtc`, never `/twirp` | `LIVEKIT_HTTP_PORT` |
| 5349/tcp | LiveKit TURN (plain, behind Caddy) | listens on all interfaces but accepts only PROXY-protocol connections from loopback; block it in the firewall | `LIVEKIT_TURN_TLS_PORT` |
| 2020/tcp | Caddy health | bound to 127.0.0.1 | `CADDY_HEALTH_PORT` |
| unix socket | PostgreSQL | no network at all (`network_mode: none`) | — |

## Configuration

- `.env` holds the infrastructure settings and secrets. Every variable is documented in `.env.example`, and the full
  list is in [docs/API.md](docs/API.md) (Environment).
- Runtime behavior is set in the admin panel and applies without a restart: registration mode, guests, video
  quality, participant and room limits, recording, retention.

## Operations

TODO(stage-09a):
- **Upgrade:** updating the code, rebuilding the images, and migrations (which run automatically before the app
  starts).
- **Backup and restore:** the database, the recordings volume, and `.env` including `RECORDING_ENCRYPTION_KEY`.
- **Troubleshooting:**
  - certificates;
  - calls that fail on networks that block UDP (TURN over TLS);
  - `LIVEKIT_NODE_IP` behind NAT;
  - `docker compose logs`, `GET /api/health` and `GET /api/ready`.

## Browser support

TODO(stage-10): fill in from the manual browser matrix in
[docs/TESTING.md §9](docs/TESTING.md#9-manual-cross-browser-matrix-user).

Targets: current Chrome, Edge, Firefox and Safari on the desktop, Safari on iOS, and Chrome on Android. Known limits:
- No screen sharing on iOS or Android: those browsers don't offer screen capture to web pages.
- No speaker (audio output) selection on Safari, iOS or Android. Audio plays on the system output.
- A browser without E2EE support gets an explanation screen. blinq never falls back to an unencrypted call.

## Development

Prerequisites:
- Node 24 (`.node-version`; ≥ 22.19 also works).
- pnpm 11.20 (`packageManager` in `package.json`).
- Docker (Docker Desktop on macOS).
- ffmpeg 9, for the recording tests.
- Playwright browsers, installed once with `pnpm exec playwright install chromium firefox webkit`.

```sh
cp .env.dev.example .env
pnpm install
pnpm dev:deps       # Postgres on 127.0.0.1:55432, LiveKit, Mailpit (http://localhost:8025)
pnpm cli bootstrap  # once: creates the dev admin from ADMIN_EMAIL / ADMIN_PASSWORD
pnpm dev            # applies migrations, then serves http://localhost:3000
```

- Sign in as `admin@blinq.local` with the dev password from `.env.dev.example`. You are asked to change it.
- Mailpit at http://localhost:8025 catches every email the app sends.
- The dev LiveKit advertises your LAN IP (`scripts/detect-ip.sh`), because Firefox rejects loopback ICE candidates.
  If detection fails (for example on a VPN), set `LIVEKIT_NODE_IP`.
- The dev Postgres uses port 55432, because a local Postgres often owns 5432.

Checks and tests (details in [docs/TESTING.md](docs/TESTING.md)):

```sh
pnpm lint && pnpm typecheck
pnpm test                                  # unit tests
sh scripts/with-lock.sh pnpm test:api      # API integration tests (builds the test server)
sh scripts/with-lock.sh pnpm build:test    # test build for E2E (setup: docs/TESTING.md §6.2)
sh scripts/with-lock.sh pnpm test:e2e      # Playwright
pnpm check:english                         # everything in the repository must be English
```

Contributors and AI agents: read [AGENT.md](AGENT.md) before changing anything.

## Documentation

| Document | Contents |
|---|---|
| [AGENT.md](AGENT.md) | rules for contributors and AI agents, the stack, commands, known gotchas |
| [docs/ROADMAP.md](docs/ROADMAP.md) | stages, status, dependencies, file ownership |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | components, topology, data model, key flows |
| [docs/API.md](docs/API.md) | HTTP API, LiveKit contracts, crypto derivations, settings, environment |
| [docs/SECURITY.md](docs/SECURITY.md) | threat model, E2EE design, hardening, vulnerability reports |
| [docs/TESTING.md](docs/TESTING.md) | test layers, commands, fixtures, CI, the manual browser matrix |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | production deployment in depth (TODO(stage-09a)) |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | load-test method, results, sizing |
| [docs/stages/](docs/stages/) | one file per implementation stage, each with its Definition of Done |

## Security

A summary of [docs/SECURITY.md](docs/SECURITY.md):
- **E2EE.** Audio, video, screen share and chat are encrypted in the browser with keys derived from the room key.
  The SFU, TURN, the network, the database and backups see only ciphertext.
- **The key never reaches the server.** It lives in the link fragment `#k=…` and in participants' browsers. The
  server stores only a hash of a join proof derived from it. Compare the safety code in a call to confirm that
  everyone has the same key.
- **Limits:**
  - blinq does not protect against a malicious or compromised app server, which could serve JavaScript that steals
    the key;
  - there is no per-sender authenticity: any key holder could impersonate another participant;
  - the server sees metadata (who joins when, display names, timing);
  - a removed participant still knows the key until the host rotates it;
  - server-stored recordings are encrypted at rest but readable by the server and admins. Local-only recordings stay
    end-to-end encrypted.
- **Hardening.** Invite-only accounts, argon2id password hashing, rate limiting with backoff, CSRF protection, a
  strict CSP, HSTS, no third-party requests, and secrets only in `.env`.
- **Report vulnerabilities privately** (docs/SECURITY.md §11), not in public issues.

## License

TBD.
