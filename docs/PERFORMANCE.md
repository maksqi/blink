# Performance

How blinq's capacity and speed are measured, where the results go, and what to provision until real numbers exist.
Stage 10 (`e2e`) runs the measurements and fills in §5. The `docs` agent then replaces the estimates in §6 and the
README sizing with measured values.

**Status: nothing has been measured yet.** Every number marked "estimate" is a planning assumption, not a result.
`(decision)` marks a choice this document makes where the plan left it open.

## 1. Metrics

| Metric | Measured on | How | Why it matters |
|---|---|---|---|
| SFU CPU (avg and p95 of 5 s samples) | SFU host | `pidstat -u -p <livekit-server pid> 5` (package `sysstat`) | forwarding cost limits concurrent meetings |
| SFU RAM (RSS) | SFU host | `pidstat -r -p <pid> 5` | sizing |
| SFU egress / ingress (Mbit/s) | SFU host NIC | `sar -n DEV 5` (LiveKit uses host networking, so the NIC shows its traffic) | egress is usually the first limit |
| App and Postgres CPU/RAM | same host | `pidstat`, `docker stats` | join API, SSE, recording ingest and transcoding |
| Client CPU | real client | OS monitor (renderer + GPU processes), Chrome task manager | E2EE plus decoding up to 24 tiles is client-heavy |
| Join time p50/p95 | real client | `blinq:join:click` → `blinq:join:first-remote-frame` | UX; gates in §7 |
| Time to first remote frame | real client | `blinq:join:connected` → `blinq:join:first-remote-frame` | subscription and layer-selection cost |
| Received quality | real client | `chrome://webrtc-internals` dump: `frameWidth`, `framesPerSecond`, `freezeCount`, `packetsLost`, `jitter`; `qualityLimitationReason` for the local camera | tells whether quality drops come from CPU or bandwidth |
| Recording cost | recorder and server | recorder CPU, upload Mbit/s, `processing` → `ready` time, peak `/work` tmpfs use, stored bytes per hour | disk and CPU sizing |

The `blinq:join:*` performance marks are recorded in every build. Test builds also copy them into
`window.__blinqTest.metrics`. Keeping the marks in production builds is what makes field measurement possible
(decision). In DevTools on a production deployment:

```js
const t = (n) => performance.getEntriesByName(n)[0].startTime
t('blinq:join:first-remote-frame') - t('blinq:join:click')
```

## 2. Rules for every measurement

- Measure a production deployment (Stage 09a compose) on a dedicated VM, never the dev stack or a laptop.
- Load generators run on hosts other than the SFU host. Each generator stays below 70% CPU; above that, the result
  measures the bots.
- Every run: 2 min warm-up, then 5 min steady state. Report avg and p95 of 5 s samples. Repeat each scenario 3 times
  and report the median run (decision).
- Record the environment (§4) with every result table. Results without an environment are discarded.

## 3. Methodology

### 3.1 SFU capacity: `lk load-test`

The LiveKit CLI starts synthetic participants that publish unencrypted test media. For SFU cost that is
representative: under E2EE the SFU forwards encrypted frames exactly the same way; the frame trailer adds only a few
bytes. The server runs with `room.auto_create: false`, so create each room first. Its API is loopback-only, so go
through an SSH tunnel and run from a repo checkout, where `livekit-server-sdk` resolves:

```sh
ssh -N -L 7880:127.0.0.1:7880 <user>@<server> &
node --input-type=module -e "
import { RoomServiceClient } from 'livekit-server-sdk'
const rs = new RoomServiceClient('http://127.0.0.1:7880', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
await rs.createRoom({ name: 'load-1', maxParticipants: 60, emptyTimeout: 600 })"

lk load-test --url wss://<DOMAIN> --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
  --room load-1 --video-publishers 25 --audio-publishers 25 --subscribers 25 \
  --layout 5x5 --simulate-speakers --duration 7m
```

- 25 publishers per room. `--subscribers` adds receive-only testers, so the SFU forwards about as many tracks as a
  real 25-person meeting. Check the tester roles with `lk load-test --help` for the pinned CLI version.
- `--layout 5x5` makes subscribers request small layers, like blinq's grid on a desktop.
- blinq's webhook handler ignores rooms that are not in its database, so the testers are not removed.
- Ladder: 1, 2, 4, 6 … concurrent rooms (one `lk load-test` process per room, from separate hosts when needed).
- Stop at the first step where SFU CPU p95 exceeds 80% of all cores, egress exceeds 80% of the NIC or plan limit, or
  subscriber packet loss exceeds 1% (decision). The last passing step is the capacity.

### 3.2 Browser bot swarm (real blinq clients, E2EE on)

This shows what `lk load-test` cannot: the client cost of E2EE, blinq's layer selection, join time under load, and
recording. One room of 25 contains:
- **23 bots:** headless Chromium (Playwright) on bot hosts. They join as guests through one room invite (`max_uses`
  ≥ 23; waiting room off) using the real `/m/<slug>#k=…&t=…` flow of the production build. Viewport 1280×720.
- **1 real client:** desktop Chrome on a physical machine with a real 720p camera and a 1920×1080 window. It records
  client CPU, received quality, 10 joins (p50/p95) and time to first remote frame.
- **1 recorder:** the room's host, signed in, who records in server mode during scenario S4 (§5.2).

Bots publish low-resolution media so that bot hosts measure blinq, not video encoding:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=15 -t 30 -pix_fmt yuv420p bot-180p.y4m
# Chromium flags: --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
#   --use-file-for-fake-video-capture=bot-180p.y4m --use-file-for-fake-audio-capture=speech.wav
```

- **Pacing.** `join-ip` allows 30 requests per minute per IP (/64), and each join makes 2 requests (`info`, then the
  join). So one source IP adds at most 15 bots per minute. Use one join every 4 s per host, and several hosts for the
  burst scenario.
- **Bot hosts** (estimate): about 1 vCPU and 1 GB RAM per bot. Verify that each host stays below 70% CPU.
- **Location** (decision): scripts live in `tests/perf/` (owner `e2e`) with their own Playwright config, outside
  `tests/e2e`, so CI never runs them. They are pointed at the target with `E2E_BASE_URL`.

### 3.3 Recording

- A 60-minute recording in each format (MP4 and WebM) in scenario S4, plus one local-only recording.
- Stored size per hour = stored bytes ÷ duration. BLQ1 adds 16 bytes per 1 MiB segment, which is negligible.
- Transcode cost = the time from `processing` to `ready` (recording timestamps or app log), the server CPU while
  ffmpeg runs (`FFMPEG_THREADS`, default 2), and the peak use of the `/work` tmpfs.

## 4. Environment template

Copy this block above every result set.

| Field | Value |
|---|---|
| Date, tester | TBD |
| blinq version / commit | TBD |
| LiveKit server / `lk` CLI version | v1.13.7 / TBD |
| Admin settings | `media.maxCameraResolution`, `media.maxScreenShareResolution`, `media.maxScreenShareFps`, `recording.maxResolution`: TBD |
| SFU host | provider, instance type, vCPU model (dedicated or shared), RAM, NIC / bandwidth plan, region, OS and kernel, Docker version: TBD |
| Bot hosts | count, instance type, vCPU, RAM, region, Chromium version, bots per host: TBD |
| Real client | device, CPU, RAM, OS, browser and version, network (wired or Wi-Fi), RTT to the server: TBD |
| Recorder | same fields as the real client: TBD |
| Network path | RTT bot hosts ↔ SFU (`ping`), throughput (`iperf3`): TBD |

## 5. Results (Stage 10)

### 5.1 SFU capacity (`lk load-test`, §3.1)

| Rooms × (25 pub + 25 sub) | SFU CPU avg / p95 | SFU RAM | Egress Mbit/s | Ingress Mbit/s | Packet loss | Pass |
|---|---|---|---|---|---|---|
| 1 | TBD | TBD | TBD | TBD | TBD | TBD |
| 2 | TBD | TBD | TBD | TBD | TBD | TBD |
| 4 | TBD | TBD | TBD | TBD | TBD | TBD |
| 6 | TBD | TBD | TBD | TBD | TBD | TBD |

### 5.2 Browser swarm (E2EE, §3.2)

| Scenario | SFU CPU p95 | Egress Mbit/s | Real client CPU | Received res / fps | Join p50 / p95 | First remote frame p50 / p95 | Freezes per min |
|---|---|---|---|---|---|---|---|
| S1: 25 cameras, grid | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| S2: S1 + screen share 1080p15 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| S3: speaker view | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| S4: S1 + server recording | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| S5: burst join, 23 bots within 60 s from ≥ 2 IPs | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

### 5.3 Recording (§3.3)

| Mode | Upload format | Duration | Recorder CPU | Upload Mbit/s | `processing` → `ready` | Peak tmpfs | Stored GB per hour |
|---|---|---|---|---|---|---|---|
| server | MP4 | 60 min | TBD | TBD | TBD | TBD | TBD |
| server | WebM | 60 min | TBD | TBD | TBD | TBD | TBD |
| local-only | browser default | 60 min | TBD | — | — | — | TBD (on the device) |

### 5.4 Client CPU by device (S1: 24 remote tiles, E2EE)

| Device / OS | Browser | CPU % | Received fps | Notes |
|---|---|---|---|---|
| Mid-range laptop (4 cores), Windows or Linux | Chrome | TBD | TBD | TBD |
| Same | Firefox | TBD | TBD | TBD |
| MacBook (Apple silicon) | Safari | TBD | TBD | TBD |
| Mid-range Android phone | Chrome | TBD | TBD | TBD |
| iPhone | Safari | TBD | TBD | TBD |

## 6. Initial sizing estimates (not measured)

The SFU, app, Postgres and Caddy share one host. The SFU is the main consumer. Estimates:

| Deployment | vCPU | RAM | Bandwidth (symmetric) | Assumed load |
|---|---|---|---|---|
| Small team | 2 | 4 GB | 100 Mbit/s | about 10 people in calls at once (for example one 8-person meeting, or several small calls) |
| Full 25-person meetings | 4+ | 8 GB | ≥ 500 Mbit/s – 1 Gbit/s | one to three concurrent 25-person meetings, with screen share |
| Recording storage | — | + `RECORDING_WORK_TMPFS_SIZE` (default 4g) while a job runs | — | ≈ 1–1.8 GB of disk per recording hour at 1080p (H.264/AAC at about 2.2–4 Mbit/s) |

How the bandwidth estimate is derived (estimate):
- Receiving dominates: each participant gets every other camera at the layer its tile needs.
- Approximate VP8 layer bitrates (`livekit-client` preset maximums): 180p ≈ 0.16 Mbit/s, 360p ≈ 0.45 Mbit/s, 720p
  ≈ 1.7 Mbit/s. Audio is about 0.03 Mbit/s per active speaker.
- A 25-person grid: 25 receivers × 24 tiles × 0.16–0.45 Mbit/s ≈ 100–270 Mbit/s of SFU egress. A 1080p15 screen share
  to 24 receivers adds about 60 Mbit/s (≈ 2.5 Mbit/s each).
- Ingress: 25 publishers × up to about 2.3 Mbit/s of simulcast layers. Dynacast pauses unused layers, so the total is
  about 15–60 Mbit/s.
- So one full meeting needs roughly 150–330 Mbit/s of egress, which is about 70–150 GB of traffic per meeting hour.
  Check your provider's egress pricing.
- CPU and RAM are the least certain estimates. E2EE adds no server CPU (the SFU never decrypts); packet forwarding and
  ffmpeg transcoding do.

## 7. Performance budgets

| Budget | Metric | Value | Enforced by |
|---|---|---|---|
| Initial JS | compressed JS transferred to render `/login` with a cold cache | TBD (Stage 10) | TBD |
| Call route chunk | compressed JS that `/m/[slug]` adds on top of the initial JS (route chunk, `livekit-client`, E2EE worker) | TBD (Stage 10) | TBD |
| Effects assets | blur model and wasm, RNNoise worklet; loaded only when a user enables them | TBD (Stage 10) | TBD |
| Join time | click → first remote frame | PR gate < 6 s (single run); nightly p95 < 3 s; target p50 < 1.5 s (plan: target 1.5 s, SLA 3 s) | e2e.yml, nightly.yml (see [`TESTING.md` §6.7](TESTING.md#67-timing-policy)) |
| Client CPU | real client in S1 | TBD (Stage 10) | manual, §5.4 |

- JS is measured against the production compose, so Caddy compression applies. A Playwright script loads the page with
  a cold cache and sums `encodedBodySize` over `performance.getEntriesByType('resource')` entries for `.js` files,
  including the E2EE worker. `pnpm exec nuxi analyze` shows what grew.
- Each TBD budget is set to the first Stage 10 baseline plus 10% headroom (decision). Once set, exceeding a budget fails
  the check. Raising a budget needs a line in the change log below explaining why.

## 8. Change log

- 2026-09-28: skeleton (methodology, templates, estimates). No measurements yet.
