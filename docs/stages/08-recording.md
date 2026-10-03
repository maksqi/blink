# Stage 08 — Recording

Status: todo
Owner(s): `recording-server` (Wave 1), `recording-client` (Wave 2)
Depends on: `recording-server`: Stage 01 (server core: `requireUser`, `requireAdmin`, `resolveCaller`, settings, audit,
`EventBus`, `Clock`, API test harness) and the `publishRoomState` stub that `rooms-backend` implements in parallel;
`recording-client`: Stage 05 (`call-core`), the `recording-server` half of this stage, Stage 04 backend (real joins)
Blocks: Stage 10; Stage 09a relies on the volume and tmpfs layout below

## Goal
Hosts and co-hosts with an account record a meeting in their own browser, the only place with plaintext media under
E2EE. A canvas compositor draws the participant grid (presenter layout during screen share) with names, WebAudio mixes
the encrypted-verified audio, and MediaRecorder chunks upload every 4 s. The server encrypts each chunk on arrival
(BLQ1), transcodes with a hardened ffmpeg into faststart H.264/AAC MP4, and serves the file with strict headers to the
recorder, the room owner and admins (admin access audited). Everyone sees the REC indicator within 1 s. Local-only mode
saves the file on the recorder's device, uploads nothing and stays end-to-end encrypted.

## Scope
### In scope
- `recording-server`: start/stop routes, chunk ingest, BLQ1, queue with ffprobe/ffmpeg, serving, quota, retention and
  partial-finalize tasks, the `/recordings` pages and the admin recordings page.
- `recording-client`: compositor, mixer, recorder, uploader, controls, start dialog, REC indicator, local-only mode,
  test hook.
### Out of scope (and where it lives instead)
- `publishRoomState` (it derives `recording` from the active row) and the `room_finished` webhook that publishes
  `recording.changed`: Stage 04 (`rooms-backend`).
- The pre-join REC notice from `recordingActive` (`POST /api/join/:slug/info`): Stage 04 and Stage 05.
- Admin settings UI for `recording.*`: Stage 03. Volumes, tmpfs `/work`, ffmpeg in the image, Caddy's 20 MB limit on
  the chunk route: Stage 09a (`infra`). Server-side (egress) recording: never, E2EE forbids it.

## Owned paths
### recording-server (Wave 1)
- `server/api/calls/[roomId]/recording/**`, `server/api/recordings/**`, `server/api/admin/recordings/**`
- `server/services/recordings/**` (colocated `*.test.ts`), `server/tasks/recordings/**`
- `app/pages/recordings/**`, `app/pages/admin/recordings.vue`, `app/components/recordings/**`
- `tests/api/recordings/**`, `tests/fixtures/media/**`
### recording-client (Wave 2)
- `app/lib/recording/**` (colocated `*.test.ts`), `app/lib/call/features/recording/**`,
  `app/components/call/recording/**`, `tests/e2e/recording/**`
### Consumes (must not edit)
- `shared/schemas/recordings.ts` (`startRecordingSchema`, `completeRecordingSchema`, `RECORDING_CHUNK_MAX_BYTES`,
  `StartRecordingResponse`, `RecordingSummary`), `shared/schemas/livekit.ts` (`roomMetadataSchema`),
  `shared/schemas/settings.ts` (`recording.*`, `publicConfigSchema`), `shared/schemas/common.ts`
  (`paginationQuerySchema`), `shared/utils/permissions.ts` (`canPerform`), `shared/utils/error-codes/index.ts`
- `server/contracts/index.ts` (`PublishRoomState`, `EventBus`, `BusEvent`, `Clock`),
  `server/services/livekit/publish-room-state.ts`, `server/utils/**` (`env.ts`: `RECORDING_ENCRYPTION_KEY`,
  `RECORDINGS_DIR`, `RECORDING_WORK_DIR`, `FFMPEG_PATH`, `FFPROBE_PATH`, `FFMPEG_THREADS`, `FFMPEG_TIMEOUT_MINUTES`),
  `server/services/{settings,audit}/**`, `server/database/**` (`recordings`), `nuxt.config.ts` (task schedule, 20 MB)
- `app/lib/contracts/{call,test-hooks}.ts` (`SubscriptionControl.setDemand`, `AudioControl.remoteAudioTracks`,
  `MediaControl`, `forceRecordingMime`), call-core code, `app/lib/layout/**`, `app/composables/useApi.ts`,
  `app/components/ui/**`, `tests/e2e/fixtures/**`

## BLQ1 at-rest format (`server/services/recordings/blq1.ts`)
- Header (49 bytes, bounds-checked): `magic "BLQ1" | version u8 = 1 | keyId u8 = 1 | segSize u32be | salt (32) |
  noncePrefix (7)`. Production writes `segSize` = 1 MiB; the reader accepts 64 B … 16 MiB so tests can use tiny segments.
- Per-file key = `HKDF-SHA256(RECORDING_ENCRYPTION_KEY, salt, "blinq/v1/rec|" + recordingId, 32 B)`.
- Segment i = AES-256-GCM(plaintext) + 16-byte tag; IV = `noncePrefix ‖ u32be(i) ‖ lastFlag (u8)`; AAD = header bytes.
  Full segments are never final; the stream always ends with a final segment of `size mod segSize` bytes (possibly
  empty), so the plaintext size follows from the file size and truncation, reordering and tampering fail.
- Chunk files (decision): each chunk is its own BLQ1 file with info `"blinq/v1/rec|" + recordingId + "|chunk|" + seq`,
  so a chunk cannot move to another position or recording. The final file uses the info above exactly.

## Tasks
### recording-server — routes and ingest
- [x] `POST /api/calls/:roomId/recording/start` (`startRecordingSchema`): `resolveCaller`; `canPerform(actor,
      'recording.start')` false → 403 `RECORDING_NOT_ALLOWED` (participants and guests); `recording.enabled` false →
      403 `RECORDING_DISABLED` (both modes, decision); dimensions above `recording.maxResolution` → 400
      `VALIDATION_FAILED` (decision); quota used up → 409 `RECORDING_QUOTA_EXCEEDED`. One transaction under
      `pg_advisory_xact_lock` on the room: an active row (`status = 'recording'`, `ended_at IS NULL`) → 409
      `RECORDING_ACTIVE`, else insert (mode, `meetingId`, `createdBy`, `sourceMime`, dimensions). Then
      `await publishRoomState(roomId)`; if it fails, delete the row and answer 503 `SERVICE_UNAVAILABLE` (no recording
      without an indicator). 201 `StartRecordingResponse`; audit `recording.started`.
- [x] `POST /api/calls/:roomId/recording/stop` (`recording.stop`, any moderator with an account): set `ended_at`,
      `publishRoomState` (indicator off), local rows → `ready` without a file (decision); nothing active → 409
      `CONFLICT` (`not_recording`); 204; audit `recording.stopped`.
- [x] `PUT /api/recordings/:id/chunks/:seq`: the recorder's session only (else 403 `FORBIDDEN`); server mode and
      `status = 'recording'` (else 409 `CONFLICT` `not_recording`); `seq` = `chunkCount` (next) or an already stored
      seq (retry: replaced, 204); a gap → 409 `CONFLICT`; `Content-Type: application/octet-stream`. Stream the raw
      request (never `readRawBody`) through a byte counter (over `RECORDING_CHUNK_MAX_BYTES` → abort, delete, 413
      `RECORDING_TOO_LARGE`), BLQ1 encryption and a temp file renamed into place. Also: quota → 409
      `RECORDING_QUOTA_EXCEEDED`; free space on `RECORDINGS_DIR` (`fs.statfs`) below 2 GiB → 503
      `SERVICE_UNAVAILABLE` (decision); a chunk later than `startedAt + maxDuration + 2 min` → 413. Updates
      `chunkCount`, `uploadedBytes`, `lastChunkAt`. Limiter `recording-chunks`.
- [x] `POST /api/recordings/:id/complete` (`completeRecordingSchema`, recorder only): `chunkCount` must equal the stored
      contiguous chunks (else 409 `CONFLICT`); sets `ended_at` if unset (+ `publishRoomState`), status `processing`,
      enqueues; 202 `{ status: 'processing' }`.
- [x] `server/services/recordings/api.ts` (entry points for other workstreams): `finalizeRecording(id, reason)`
      (idempotent) and `deleteRecordingsForUser(userId)` (Stage 03 deletes files before the user row cascades).
- [x] Bus: `recording.changed` (from `rooms-backend` on `room_finished`) → `finalizeRecording(…, 'meeting-ended')`.
      (decision) Request a sync Nitro plugin that subscribes at boot (`server/plugins/**` is not ours) and, from
      `rooms-backend`, the same event when the recorder leaves; the finalize-stale task is the backstop.
### recording-server — processing
- [x] `queue.ts`: in-memory FIFO, concurrency 1, the DB is the source of truth. After a restart the finalize-stale task
      re-enqueues `processing` rows; a job interrupted by a restart retries once, then fails (marker in `error`)
      (decision).
- [x] Probe (`probe.ts`, pure allowlist over ffprobe JSON): decrypt chunks in order into `ffprobe -v error
      -protocol_whitelist pipe,file -f <matroska|mov> -show_entries stream=codec_type,codec_name,width,height:
      format=format_name,duration -of json pipe:0` (demuxer forced from `sourceMime`: webm → `matroska`, mp4 → `mov`;
      at most 32 MiB fed). Accept only the forced family, ≥ 1 video stream `h264`|`vp8`|`vp9`, optional audio
      `aac`|`opus`, 0 < width, height ≤ 4096, declared duration ≤ `recording.maxDurationMinutes` + 1 min. Anything
      else → `failed` (`invalid_media`) without running ffmpeg.
- [x] Transcode (`ffmpeg-args.ts` pure builder, `transcode.ts` → implemented as `processor.ts` + `tools.ts`): decrypt chunks into ffmpeg `pipe:0`; write the output
      to `RECORDING_WORK_DIR/<id>/out.mp4` (tmpfs; `+faststart` needs a seekable file). Always re-encode, never
      `-c copy`. `W×H` = source size rounded to even, capped at 1280×720 or 1920×1080 (`recording.maxResolution`):
      ```
      -nostdin -hide_banner -loglevel error -max_alloc 536870912 -protocol_whitelist pipe,file
      -f <matroska|mov> -max_pixels 16777216 -i pipe:0
      -map 0:v:0 -map 0:a:0? -map_metadata -1 -map_chapters -1 -dn -sn
      -vf scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1
      -fps_mode cfr -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -ar 48000 -ac 2
      -t <maxDurationSec> -fs <workDirBudgetBytes> -threads <FFMPEG_THREADS> -movflags +faststart -f mp4 <out>
      ```
- [x] Child processes: `spawn(FFMPEG_PATH | FFPROBE_PATH, args, { env: { PATH: process.env.PATH } })` (no secrets),
      `os.setPriority(pid, 10)`, SIGKILL after `FFMPEG_TIMEOUT_MINUTES`, stderr kept to 64 KiB, work dir wiped in
      `finally`. In production, refuse to process while `RECORDING_WORK_DIR` is not a tmpfs mount (`/proc/self/mounts`):
      the row stays `processing` and an error is logged (decision).
- [x] Finish: ffprobe the output (h264, plus aac when the input had audio) → encrypt to
      `RECORDINGS_DIR/<id>/recording.blq1` (temp, rename, fsync) → `ready` with `storageKey`, `sizeBytes` (plaintext),
      `durationMs`, `width`, `height`, `processedAt`, `expiresAt = processedAt + recording.retentionDays` → delete the
      chunk files. Failure → `failed` with a short `error` (`invalid_media`, `timeout`, `ffmpeg_failed`,
      `too_large`) and chunks deleted.
### recording-server — serving, lists, tasks, pages
- [x] Access: recorder, room owner or admin; anyone else 404 `NOT_FOUND` (no existence oracle). `GET /api/recordings`
      (`paginationQuerySchema`) → `Paginated<RecordingSummary>` of own recordings and recordings of owned rooms, newest
      first; `GET /api/recordings/:id` → `{ recording }`; `DELETE` → 409 `CONFLICT` while `recording` or
      `processing`, else files and row deleted, 204, audited.
- [x] `GET /api/recordings/:id/file`: `recording`/`processing` → 409 `RECORDING_NOT_READY`; `failed` or local → 404.
      Pure `range.ts`: single `bytes=a-b`, `a-`, `-n`; several ranges → ignored, 200 full; unsatisfiable → 416 with
      `Content-Range: bytes */<size>`. Decrypt only the covering segments (the first before headers are sent; a later
      integrity failure destroys the socket). Headers: `Content-Type: video/mp4`, `X-Content-Type-Options: nosniff`,
      `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: no-store`, `Accept-Ranges: bytes`,
      `Content-Disposition: inline` (`attachment` with `?download=1`) with `filename="blinq-recording.mp4"` plus an
      RFC 5987 `filename*=UTF-8''…` built from room name and date. Stream with backpressure, never buffer the file.
- [x] Audit: an admin who is neither recorder nor owner → `recording.admin_playback` / `recording.admin_download`, at
      most once per admin, recording and kind per 10 min because players repeat Range requests (decision).
- [x] `GET /api/admin/recordings` (`requireAdmin`; `q` matches room name or creator) → `Paginated<RecordingSummary>`;
      `DELETE /api/admin/recordings/:id` in any state (cancels the job, ends an active row with `publishRoomState`),
      audited `admin.recording_deleted`.
- [x] Quota (`quota.ts`): usage = sum of the user's server rows (`sizeBytes` when ready, else `uploadedBytes`);
      `recording.userQuotaGb` 0 = unlimited.
- [x] `server/tasks/recordings/finalize-stale.ts` (`recordings:finalize-stale`, every 2 min) → `finalizeStale({ clock,
      publishRoomState })`: server rows still `recording` with no chunk for 2 min (`lastChunkAt ?? startedAt`), whose
      recorder row is `left`/`removed`, or whose meeting ended → `partial = true` and `processing` (`failed` without
      chunks), `publishRoomState` if the indicator was on; local rows of ended meetings → `ready`; `processing` rows
      missing from the queue → enqueue.
- [x] `server/tasks/recordings/retention.ts` (`recordings:retention`, daily) → `applyRetention({ clock })`: delete rows
      and files past `expiresAt`, `failed` and local rows older than `recording.retentionDays`, orphan directories
      older than 1 day.
- [x] Pages: `app/pages/recordings/index.vue` (room, date, duration, size, status incl. Partial; local rows "Saved on the
      recorder's device" without playback; Play, Download via `?download=1`, Delete; polls every 5 s while a row is
      `recording`/`processing`), `app/pages/recordings/[id].vue` (`<video controls preload="metadata">` on the file URL,
      partial notice "This recording ended unexpectedly and may be incomplete.", expiry, download, delete),
      `app/pages/admin/recordings.vue` (all recordings, search, delete; "Admin playback is recorded in the audit log.").
      Components in `app/components/recordings/`. Until the Stage 02 middleware is merged, pages handle 401/403 from
      the API themselves; request nav entries if missing (navigation is frozen).
### recording-client — capture pipeline (`app/lib/recording/`)
- [x] `mime.ts` (pure) `pickRecordingMime(isTypeSupported, forcedPrefix)`: `video/mp4;codecs=avc1.64001F,mp4a.40.2` →
      `video/mp4;codecs=avc1.42E01F,mp4a.40.2` → `video/mp4;codecs=avc1.64001F,opus` → `video/mp4;codecs=avc1,opus` →
      `video/webm;codecs=vp9,opus` → `video/webm;codecs=vp8,opus` → `video/webm` (Firefox lands on webm).
      `forceRecordingMime('video/mp4' | 'video/webm')` keeps only that family; none supported → a visible error
      (decision).
- [x] `clock.worker.ts` (`import ClockWorker from './clock.worker?worker'`, same-origin): ticks every 1000/30 ms and keeps
      drawing in background tabs, where rAF stops and main-thread timers throttle (`clock.ts` falls back to a
      main-thread interval only where workers are unavailable).
- [x] `layout.ts` (pure): grid from `computeGrid` (`app/lib/layout/`) for 1..25 tiles; presenter layout while someone
      shares (share ≈ 80 % width plus a filmstrip); 16:9 canvas sized from `GET /api/config` `recording.maxResolution`.
- [x] `compositor.ts`: canvas `captureStream(0)`; each tick draws tiles (cover fit), names, muted-mic icon, initials when
      the camera is off, then calls `requestFrame()` on the canvas track (Chrome, Safari) or on the stream (Firefox).
      Sources (`sources.ts`, pure filter): local camera `ctx.media.cameraTrack()` (processed), own screen share, and
      remote camera/screen tracks from `ctx.room` publications that are `isEncrypted` and subscribed; `<video muted
      playsinline>` elements in a hidden 1 px container inside the DOM. (decision) Screen shares are drawn with
      `contain`, never cropped; drawing lives in `draw.ts`, the scene, demand and mix wiring in `pipeline.ts`.
- [x] Demand: `ctx.subscriptions.setDemand('recording', …)` for every remote camera at its tile size and screen shares at
      canvas size; remove it on stop.
- [x] `mixer.ts`: its own 48 kHz AudioContext → `MediaStreamAudioDestinationNode`. Sources:
      `ctx.audio.remoteAudioTracks()` (encrypted-verified; identity matched via `ctx.room` publications by
      `mediaStreamTrack.id`), each through a
      GainNode at host `vol` / 100 (the recorder's own `setLocalVolume` is ignored), plus the processed mic
      `ctx.media.micTrack()`; re-synced on subscription changes. Never detach or add `<audio>` elements.
- [x] `recorder.ts`: `new MediaRecorder(new MediaStream([canvasTrack, mixTrack]), { mimeType, videoBitsPerSecond:
      2_500_000 (1080p) or 1_500_000 (720p), audioBitsPerSecond: 128_000 })` (decision), `start(4000)`; empty blobs
      consume no seq; `onerror` → stop and complete.
- [x] `uploader.ts`: ordered queue, one `PUT /api/recordings/:id/chunks/:seq` in flight; retry with exponential backoff
      and jitter (0.5 s → 30 s) on network errors, 5xx, 408 and 429 (`Retry-After` honored); 409 `not_recording` →
      stop locally; other 4xx stop with an error; backlog over 256 MB → "Uploading is falling behind"; after the last
      ack `POST /api/recordings/:id/complete { chunkCount, durationMs }`.
- [x] Local-only mode: same pipeline, blobs kept in memory, never uploaded; on stop, download `new Blob(parts, { type })`
      as `blinq-<room>-<date>.<webm|mp4>` (raw MediaRecorder output) and revoke the object URL afterwards.
      (decision) `<room>` is the slug (the call context has no room name); the URL is revoked 60 s later.
### recording-client — feature and UI
- [x] `app/lib/call/features/recording/index.ts`: `defineCallFeature({ id: 'recording', controlBar, setup })`.
- [x] `app/components/call/recording/RecordButton.vue` (`visible` when `canPerform(self, 'recording.start')` and
      `config.recording.enabled`) with a timer, a warning 5 min before `maxDurationMs` and auto-stop at the limit. (decision) The warning and the
      auto-stop run on the controller's frame clock (`controller.ts`), so they also fire in background tabs; while
      someone else records, the button stops that recording (`recording.stop`).
- [x] `StartRecordingDialog.vue`: "Record to the server" — "The recording is uploaded and stored encrypted on the server;
      the server and its admins can decrypt it." — or "Save to this device only" — "The file stays on this device and
      is never uploaded." Both add "Everyone in the meeting will see that you are recording."
- [x] Start: `ctx.callApi('/recording/start', { method: 'POST', body: { mode, mimeType, width, height } })`, and only
      after the 201 start MediaRecorder, so nothing is captured before the indicator is published.
- [x] `RecordingIndicator.vue` for everyone (ControlBarItem, placement `start`) from `ctx.roomState.recording`: red dot
      "REC", time since `startedAt`, tooltip per mode (server: the disclosure above; local: "Recording on <by>'s
      device"); `aria-live` announcement and a toast on start and stop (the toast comes from the feature's `setup`,
      once per call; a late joiner gets "This meeting is being recorded.").
- [x] `RecordingStatus.vue` (recorder only): backlog and retries. When `roomState.recording` turns null or changes, or the
      phase leaves `inCall`, stop, flush and complete (best effort); `beforeunload` warns while recording. (decision) A
      reconnect (`reconnecting`) keeps recording; an indicator still missing 10 s after the 201 stops the recording
      with an error; an upload that fails for good (quota, 4xx) or answers `not_recording` stops capturing too.
- [x] Test hooks: honor `forceRecordingMime`; publish `testHooks()?.state.recording = { recordingId, mime,
      chunksProduced, chunksAcked, retries }`. E2E joins are DB-backed (Stage 06 fixture or a local copy in
      `tests/e2e/recording/fixtures/`). The state also carries `phase`, `mode`, `error`, `backlogBytes`, `startedAt`
      and `framesDrawn`; the E2E helpers (`recordingCall`, ffprobe/volumedetect/freezedetect, chunk-failure injection,
      background-tab emulation) live in `tests/e2e/fixtures/recording.ts` on top of the `rooms` fixture.

## Tests
- Unit, server (`server/services/recordings/`): `blq1.test.ts` (round trip for 0, 1, seg−1, seg, seg+1 and many
  segments; bit flips in header, ciphertext and tag; truncation at a boundary, mid-segment and inside the header;
  swapped segments; wrong recording id; unknown keyId; every `(a, b)` range of a small file equals the plaintext slice),
  `range.test.ts`, `probe.test.ts`, `ffmpeg-args.test.ts` (every hardening flag, never `-c copy`), `queue.test.ts`,
  `quota.test.ts`.
- API (`tests/api/recordings/`, real ffmpeg; fixtures from a committed `tests/fixtures/media/generate.sh` using lavfi):
  `start-stop.test.ts` (host and co-host with accounts 201; guest co-host and participant 403 `RECORDING_NOT_ALLOWED`;
  outsider 403 `CALL_NOT_PARTICIPANT`; second start 409; disabled 403; the fake RoomService (`docs/API.md` §11)
  records `updateRoomMetadata` with `recording` set, then null), `chunks.test.ts` (non-recorder 403, gap 409, retry
  204, over 16 MiB with chunked transfer and no `Content-Length` → 413 and nothing stored, quota 409, stored files start
  with `BLQ1` and contain neither `ftyp` nor the EBML magic `1A 45 DF A3`), `processing.test.ts` (webm vp9/opus and
  vp8/opus, fragmented mp4 h264/aac and h264/opus split into chunks → `ready`; output H.264/AAC, `moov` before `mdat`,
  input metadata, chapters, data and subtitle streams gone), `malicious.test.ts` (wrong container for the MIME, an
  HLS/ffconcat text file, 8192×8192 frames, audio only, an unsupported codec → `failed`, ffmpeg never started),
  `file.test.ts` (exact bytes for many ranges, 416, every header, `?download=1`, RFC 5987 name for a non-ASCII room
  name written as `\u` escapes, tampered or truncated file → error), `access.test.ts` (list scope, 404 for other users,
  admin sees all, one audit row per admin playback), `tasks.test.ts` (`finalizeStale` and `applyRetention` with a fake
  `Clock` against the API test DB: 2 min without chunks → partial, recorder left → finalized, `processing` re-enqueued
  after a simulated restart, expired rows and files deleted, others kept).
- Unit, client (`app/lib/recording/`): `mime.test.ts`, `layout.test.ts` (1..25, presenter), `sources.test.ts`
  (unencrypted or unsubscribed publications never drawn or mixed), `uploader.test.ts` (order, backoff, `Retry-After`,
  `not_recording` stops, complete after the last ack; fake timers), `mixer.test.ts` (`vol` gains).
- E2E (`tests/e2e/recording/`, Chromium; `formats` and `indicator` also on Firefox with webm): `formats.spec.ts`
  (`forceRecordingMime('video/webm')`, then `'video/mp4'`; 10 s with two participants → `ready`; the downloaded file
  has one video and one audio stream and a duration of 10 ± 1.5 s in `ffprobe`; `ffmpeg -af volumedetect`
  `mean_volume` > −50 dB), `chunk-failures.spec.ts` (`page.route` aborts every third chunk attempt and answers one with
  503 → `ready`, `chunkCount` = `state.recording.chunksProduced`), `indicator.spec.ts` (visible for the participant
  ≤ 1 s after the 201, gone ≤ 1 s after stop, a late joiner sees it on connect, a co-host's stop makes the recorder
  complete), `permissions.spec.ts` (no record button for guests and participants; their direct API call → 403),
  `local-mode.spec.ts` (a `download` event with a file ffprobe accepts, no chunk requests), `playback.spec.ts`
  (`/recordings` lists it and `/recordings/[id]` plays it, `video.readyState ≥ 2`).

## Definition of Done
### recording-server
- [x] [auto] Stored bytes are ciphertext (no `ftyp` or EBML magic) — evidence: `tests/api/recordings/chunks.test.ts`.
- [x] [auto] Tampering, truncation or reordering ⇒ error — evidence: `server/services/recordings/blq1.test.ts`,
      `tests/api/recordings/file.test.ts`.
- [x] [auto] Range responses are exact — evidence: `server/services/recordings/blq1.test.ts`,
      `tests/api/recordings/file.test.ts`.
- [x] [auto] Guests and participants get 403 — evidence: `tests/api/recordings/start-stop.test.ts`.
- [x] [auto] Start and stop publish the room state (`recording` set, then cleared) — evidence:
      `tests/api/recordings/start-stop.test.ts` (in-process with a DB-derived fake publisher; the fake-RoomService
      `updateRoomMetadata` check skips itself until `rooms-backend` provides `/api/__test/livekit-calls`).
- [x] [auto] Retention and partial finalize work with an injected clock — evidence: `tests/api/recordings/tasks.test.ts`.
- [x] [auto] A malicious-input fixture (wrong container, huge dimensions) is rejected — evidence:
      `tests/api/recordings/malicious.test.ts`.
- [x] [auto] Admin playback is audited — evidence: `tests/api/recordings/access.test.ts`.
- [x] [auto] No IDOR on list, get, file and delete — evidence: `tests/api/recordings/access.test.ts`.
- [x] [auto] ffmpeg runs with every hardening flag and the output is faststart H.264/AAC without input metadata —
      evidence: `server/services/recordings/ffmpeg-args.test.ts`, `tests/api/recordings/processing.test.ts`.
- [x] [auto] Chunk size, order and quota limits hold; file responses carry the exact headers — evidence:
      `tests/api/recordings/chunks.test.ts`, `tests/api/recordings/file.test.ts`.
- [x] [auto] `lint`, `typecheck`, `test`, `test:api`, `build` and `check:english` are green — evidence: ci.yml.
- [x] [agent-manual] No plaintext reaches persistent disk: only `.blq1` files exist under `RECORDINGS_DIR` while a job
      runs — evidence: `find <RECORDINGS_DIR> -type f` during `processing.test.ts`, pasted into the report.
- [x] [agent-manual] `/recordings`, `/recordings/[id]` and `/admin/recordings` list, play, download and delete seeded
      recordings — evidence: report notes (automated later by `recording/playback`).
### recording-client
- [x] [auto] Both formats (forced webm and mp4) reach `ready`; ffprobe shows ≈ 10 s with audio and video; the audio is not
      silent (`volumedetect`) — evidence: `pnpm test:e2e -- recording/formats` (Chromium webm and mp4: one h264 and
      one aac stream, 10 ± 1.5 s, mean volume -20.9 / -21.1 dB with the host's own mic off, so the sound is the
      participant's remote audio; Firefox webm -23.1 dB, mp4 skipped with an annotation).
- [x] [auto] Chunk failures injected via `page.route` still produce a complete file — evidence:
      `pnpm test:e2e -- recording/chunk-failures` (every third attempt aborted, the second answered 503; `retries` =
      injected failures, `complete.chunkCount` = `chunksProduced`, `ready`, 14 ± 1.5 s).
- [x] [auto] The indicator reaches everyone in ≤ 1 s — evidence: `pnpm test:e2e -- recording/indicator` (Chromium and
      Firefox: REC shown 1 ms before the recorder read the 201 and hidden 0–2 ms around the stop's 204, because the
      metadata update is published before the response; a late joiner sees it on connect; a co-host's stop makes the
      recorder upload the rest and complete).
- [x] [auto] Guests and participants cannot record (UI hidden, API 403) — evidence:
      `pnpm test:e2e -- recording/permissions` (also a guest promoted to co-host).
- [x] [auto] Local-only mode downloads the file and uploads nothing — evidence: `pnpm test:e2e -- recording/local-mode`.
- [x] [auto] Only encrypted-verified tracks are drawn and mixed — evidence: `app/lib/recording/sources.test.ts`.
- [x] [auto] MIME order, layout and uploader logic are unit-tested — evidence: `app/lib/recording/mime.test.ts`,
      `app/lib/recording/layout.test.ts`, `app/lib/recording/uploader.test.ts` (also `mixer`, `recorder`,
      `controller`, `announce` and `local-file` tests).
- [x] [auto] A recording plays from the recordings page — evidence: `pnpm test:e2e -- recording/playback`.
- [x] [auto] No console errors or CSP violations — evidence: `pnpm test:e2e -- recording` (base fixture).
- [x] [auto] `lint`, `typecheck`, `test`, `build` and `check:english` are green — evidence: ci.yml.
- [x] [agent-manual] Recording keeps going for 60 s with the recorder's tab in the background (no frozen stretch in the
      result) — evidence: `tests/e2e/recording/background.spec.ts` (`@nightly`). Playwright keeps every page visible
      (focus emulation; headless windows never occlude, verified with bringToFront and window minimizing), so the
      spec gives the recorder's page what a hidden tab gets: `visibilityState` hidden with `visibilitychange`, no
      rAF, main-thread timers at most once per second (a 33 ms interval fired 3 times in 3 s); workers untouched.
      Over 60 s hidden the compositor drew 30.3 fps and chunks kept coming; for the 63.2 s result
      `ffmpeg -vf freezedetect=n=-60dB:d=0.5` reports no frozen stretch.
- [ ] [user] Safari (macOS, iOS) records mp4, Firefox records webm, and both play back — evidence: manual browser matrix
      in `docs/TESTING.md`.

## Notes and gotchas
- Server-stored recordings are readable by the server and its admins (`docs/SECURITY.md` §6); the dialog and tooltip
  must say so. Local-only mode is the E2EE option.
- `readRawBody` buffers the body. The chunk handler streams `event.node.req`, and nothing may read it first.
  nuxt-security's size limiter trusts `Content-Length`, so count bytes yourself; Caddy allows 20 MB only on this route.
- Node's GCM `decipher.update()` returns unauthenticated plaintext: hold each segment until `final()` succeeds.
- MediaRecorder chunks are consecutive slices of one stream and only chunk 0 carries the header. Concatenation in order
  is the file; never transcode chunks separately.
- `+faststart` rewrites the output, so it must be a seekable tmpfs file; the input streams through `pipe:0`.
- Playwright's bundled Chromium may lack proprietary codecs. If `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1…')`
  is false there, request a Google Chrome channel project (devops-ci) for the mp4 case instead of skipping it. Linux
  Chrome may offer mp4 only with opus; the server re-encodes to AAC anyway.
- `requestFrame()` is on the canvas track in Chrome and Safari and on the stream in Firefox.
- Chrome bug 40094084: remote WebRTC audio is silent in WebAudio unless an element plays it; call-core's elements must
  stay attached.
- API tests need `ffmpeg`/`ffprobe` on PATH (local 9.0.2, CI static-ffmpeg; request it for the API job if missing).
  Dev defaults (`.data/recordings`, `.data/work`) are not tmpfs, so dev plaintext does touch disk.
- Losing `RECORDING_ENCRYPTION_KEY` makes every recording unrecoverable; the header's `keyId` leaves room for rotation.
- Worktrees: `node scripts/worktree-setup.mjs recording-server <port>` or `recording-client <port>`; heavy runs through
  `sh scripts/with-lock.sh pnpm test:api` and `sh scripts/with-lock.sh pnpm test:e2e -- recording`.
