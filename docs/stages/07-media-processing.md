# Stage 07 — Media processing

Status: todo
Owner(s): `media-fx` (Wave 2)
Depends on: Stage 05 (`call-core`: `MediaControl`, `AudioControl`, the shared 48 kHz AudioContext and mic `GainNode` in
`app/lib/livekit/audio-context.ts`, the pre-join slot and settings-section registries, pre-join track reuse)
Blocks: Stage 10

## Goal
Participants can blur their background, choose noise suppression (off, browser, RNNoise) and set their own mic gain,
both in pre-join and during the call. Switching any of these never republishes a track: peers keep the same
publication and keep receiving frames. Every asset (MediaPipe wasm and model, RNNoise worklet and wasm) is self-hosted
under `/vendor/`, so the browser makes no request to another origin. Unsupported browsers get a clear explanation
instead of broken controls, and heavy CPU use triggers a warning.

## Scope
### In scope
- `scripts/vendor-assets.mjs` and `public/vendor/**`: `@mediapipe/tasks-vision` 0.10.14 wasm, the committed selfie
  segmenter model, the RNNoise worklet and wasm.
- Background blur with the `@livekit/track-processors` 0.8 `BackgroundProcessor`.
- Noise suppression `off` | `browser` (default) | `rnnoise` (`@sapphi-red/web-noise-suppressor` 0.4) and own mic gain
  through `AudioControl.setMicGain`.
- Per-device persistence, pre-join and in-call controls, feature detection with fallback, CPU warning.
### Out of scope (and where it lives instead)
- Creating, publishing and restarting local tracks, the shared AudioContext and the mic GainNode: Stage 05
  (`call-core`). media-fx only plugs into them.
- Device and speaker selection: Stage 05. Virtual backgrounds (images): backlog.
- Running the vendor script in the Docker build and CI: Stage 09a (`infra`) and `devops-ci`, by request (below).

## Owned paths
- `app/lib/media/**` (colocated `*.test.ts` included), `app/lib/call/features/effects/**`,
  `app/components/call/effects/**`
- `scripts/vendor-assets.mjs`, `public/vendor/**` (only `public/vendor/mediapipe/*.tflite` and
  `public/vendor/mediapipe/README.md` are committed; `.gitignore` already ignores the rest)
- `tests/e2e/media/**`
### Consumes (must not edit)
- `app/lib/contracts/call.ts` (`CallContext`, `MediaControl`, `AudioControl`, `PreJoinSlot`, `SettingsSection`,
  `ControlBarItem`, `defineCallFeature`), `app/lib/contracts/test-hooks.ts` (`testHooks()`)
- call-core: `app/lib/livekit/**` (incl. `audio-context.ts`), `app/lib/call/**`, `app/components/call/core/**`
- `nuxt.config.ts` (CSP `script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`,
  `connect-src 'self'`), `package.json` pins, `.gitignore`, `scripts/worktree-setup.mjs` (already runs the vendor
  script once it exists), `tests/e2e/fixtures/**`, `docs/TESTING.md` (rows added by request)

## Tasks
### Requests to the orchestrator (resolved in Wave 1 and the Wave 2 preparation)
- [x] `MediaControl` (`app/lib/contracts/call.ts`, implemented in `app/lib/livekit/{local-media,audio-context}.ts`):
      ```ts
      /** Attach or replace the camera processor; call-core keeps it on the current and every later camera track. */
      setCameraProcessor(processor: TrackProcessor<Track.Kind.Video> | null): Promise<void>
      /** source → insert → GainNode → published track. connect() runs again after every mic restart or device switch. */
      setMicInsert(insert: MicInsert | null): Promise<void>   // MicInsert = { id; connect(context, input): Promise<AudioNode>; dispose() }
      /** Re-acquire the mic with new processing constraints via restartTrack (no republish). */
      setMicProcessing(constraints: { noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }): Promise<void>
      ```
      Replacing an insert disposes the previous one. On Firefox the AudioContext may run at the device's sample rate,
      so check `sampleRate === 48000` before enabling RNNoise.
- [x] `pnpm dev`, `pnpm build` and `pnpm build:test` run `node scripts/vendor-assets.mjs` first (`package.json`
      `vendor` script), so ci.yml, e2e.yml (`scripts/e2e.sh`) and the Dockerfile (`pnpm build`) get the files too.
      The script itself is still a stub: implementing it is a media-fx task below.
- [x] Test hook `measureNoiseSuppression?(): Promise<{ inputDb: number; outputDb: number; peak: number }>` in
      `app/lib/contracts/test-hooks.ts`, used by the offline RNNoise spec.
- [x] Blur and noise-suppression rows exist in the manual browser matrix of `docs/TESTING.md`.
- Feature `setup(ctx)` runs when the call session is created (pre-join), before the room connects.
### Vendored assets
- [x] `scripts/vendor-assets.mjs` (Node, no network, idempotent): copy
      `node_modules/@mediapipe/tasks-vision/wasm/{vision_wasm_internal,vision_wasm_nosimd_internal}.{js,wasm}` →
      `public/vendor/mediapipe/wasm/`; copy `@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js`,
      `dist/rnnoise.wasm` and `dist/rnnoise_simd.wasm` → `public/vendor/rnnoise/`. Fail with a clear message when a
      source file is missing, when the installed `@mediapipe/tasks-vision` is not exactly `0.10.14`, or when the
      committed model's sha256 differs from the constant in the script. Print one summary line.
- [x] Model `public/vendor/mediapipe/selfie_segmenter.tflite` (float16 selfie segmenter, the track-processors default),
      fetched once by hand and committed; `public/vendor/mediapipe/README.md` records source URL, version, license and
      sha256.
- [x] `app/lib/media/vendor-paths.ts` is the only place with `/vendor/...` paths: `tasksVisionFileSet:
      '/vendor/mediapipe/wasm'`, `modelAssetPath: '/vendor/mediapipe/selfie_segmenter.tflite'`,
      `/vendor/rnnoise/workletProcessor.js`, `/vendor/rnnoise/rnnoise.wasm`, `/vendor/rnnoise/rnnoise_simd.wasm`.
### Background blur
- [x] `app/lib/media/support.ts`: `supportsBlur()` = `supportsBackgroundProcessors()` from `@livekit/track-processors`
      (needs `OffscreenCanvas`, `VideoFrame`, `createImageBitmap` and WebGL2: Chrome/Edge, Firefox ≥ 130, Safari ≥ 16.4);
      `supportsRnnoise()` = `AudioWorkletNode` + `WebAssembly` + a 48 kHz shared context. Pure over an injectable
      environment for tests.
- [x] `app/lib/media/blur.ts`: create the processor once per call page with `BackgroundProcessor({ mode: 'disabled',
      assetPaths, maxFps: 30 })`; attach it on the first enable (`setCameraProcessor`), afterwards only
      `processor.switchTo({ mode: 'background-blur', blurRadius })` and `switchTo({ mode: 'disabled' })`. Never
      `stopProcessor()` or unpublish during a call; destroy on leave. Levels `off` | `light` (radius 6) | `strong`
      (radius 14) (decision).
- [x] The first enable shows "Loading background blur…" while wasm and model load. A load or init failure → toast
      "Background blur isn't available right now", the control returns to off, the unprocessed track keeps flowing.
- [x] Blur survives camera off/on and device switches (call-core re-applies the processor; covered in E2E).
### Noise suppression and mic gain
- [x] `app/lib/media/constraints.ts` (pure): `off` → `noiseSuppression: false`; `browser` → `true`; `rnnoise` → `false`
      plus the worklet. `echoCancellation` and `autoGainControl` stay on in every mode (decision).
- [x] `app/lib/media/rnnoise.ts` on `ctx.media.audioContext()` (assert `sampleRate === 48000`, else RNNoise is
      unavailable): `audioWorklet.addModule('/vendor/rnnoise/workletProcessor.js')` once per context (a same-origin
      file, never a `blob:` URL); `loadRnnoise({ url, simdUrl })` cached; `new RnnoiseWorkletNode(ctx, { maxChannels: 1,
      wasmBinary })`; inserted through a `MicInsert` with `setMicInsert(insert)`; `processorerror` → fall back to
      `browser` with a toast.
- [x] Switch order: constraints first (`setMicProcessing`), then insert or remove the `MicInsert` (`setMicInsert`). The
      mic publication keeps its `trackSid`.
- [x] Mic gain slider 0–200 % (default 100 %) → `ctx.audio.setMicGain(gain)`; the pre-join meter (call-core) reflects it.
### Preferences, UI and warnings
- [x] `app/lib/media/preferences.ts`: localStorage `blinq:media:v1`, zod-validated on read (garbage ignored), every
      access in try/catch. Blur per camera `deviceId`; noise mode and gain per microphone `deviceId`; a browser-wide
      default for unknown devices (decision). Defaults: blur `off`, noise `browser`, gain 1.
- [x] `app/lib/call/features/effects/index.ts`: `defineCallFeature({ id: 'effects', preJoin, settings, controlBar,
      setup })`. `setup` applies saved preferences to the pre-join tracks, re-applies them after device changes,
      publishes `testHooks()?.state.media = { blur, noise, gain, cameraTrackSid, micTrackSid }` and cleans up on leave.
- [x] `app/components/call/effects/PreJoinEffects.vue` (pre-join slot) and `EffectsSettings.vue` (settings section "Video
      and audio effects"): blur level; noise suppression "Off" / "Browser" / "Enhanced (RNNoise)"; mic gain. An
      unsupported control stays visible, disabled, with the reason ("Your browser can't blur the background").
- [x] `app/components/call/effects/BlurToggle.vue`: ControlBarItem in `overflow` ("Blur background" on/off).
- [x] `app/lib/media/cpu-monitor.ts` (pure core): warn when the rolling 10 s average of `onFrameProcessed`
      `processingTimeMs` exceeds 80 % of the frame budget, or the camera sender reports `qualityLimitationReason ===
      'cpu'` for 10 s (`LocalVideoTrack.getSenderStats()`). Toast "Background blur is using a lot of CPU. Turn it off if
      your video stutters." with a "Turn off" action, at most once per call.
### Implementation notes (media-fx)
- The orchestration lives in `app/lib/call/features/effects/controller.ts` (`EffectsController`, unit-tested with fakes);
  components find it with `effectsFor(useCall())`. It reads the call store for device ids, `cameraOn` and `micGain`.
- Blur attach timing (decision): in pre-join the processor attaches once the camera runs (a MediaPipe failure never
  breaks the camera start); in a call it attaches right away, even with the camera off, so the first published frame
  is processed. A processor that never ran and a camera that then fails with `failed` count as a blur failure.
- One RNNoise node per AudioContext is reused by every insert: the library's processor ignores its `destroy` message
  (its port is never started), so a node per insert would keep running. `connect()` never throws (pass-through plus
  `onError`), because it runs while call-core (re)starts the mic.
- Fallbacks (blur failure, RNNoise unavailable) are not remembered (decision): the saved choice is retried next call.
- The settings section has no second mic gain slider (decision): core's "Audio" section already shows one, and every
  change of the store's `micGain` is remembered per microphone. The pre-join slot has the slider.
- "Blur background" turns on the last level chosen (default `strong`, decision).
- Test hooks: `state.media` also carries `blurActive`, `blurLoading`, `blurFrames`, `rnnoiseActive`, `noiseBusy`,
  `sampleRate`, `micProcessing`, the device ids and both support results; `state.mediaFx.restartCamera()` restarts the
  published camera like a device switch (the E2E browsers have one fake camera).
- `measureNoiseSuppression()` waits before `startRendering()`: the worklet loads its wasm asynchronously and Firefox has
  no `OfflineAudioContext.suspend()`. Measured: -30.0 dBFS in, -59.5 dBFS out (Chromium, Firefox and a Node run of the
  same processor agree).

## Tests
- Unit (colocated in `app/lib/media/`): `preferences.test.ts` (per-device keys, defaults, invalid JSON, storage
  throwing), `support.test.ts` (feature matrix with stubbed globals), `constraints.test.ts`, `cpu-monitor.test.ts`
  (thresholds, once per call).
- API: none.
- E2E (`tests/e2e/media/`, Chromium and Firefox):
  - `blur-swap.spec.ts`: blur on in pre-join, join, then off/on/off three times. On the peer, call-core's
    `state.inboundVideo` shows the same camera `trackSid` throughout and `framesDecoded` keeps increasing with no gap
    over 1 s; the local `state.media.cameraTrackSid` never changes. Camera off/on and a device switch keep blur on.
  - `mic-chain.spec.ts`: browser → rnnoise → off → browser; the mic `trackSid` never changes on either side; in `off`
    and `browser` the peer receives the fake tone (inbound audio level > 0 via call-core stats; request
    `state.inboundAudio` if missing); gain 0 in `off` mode drops the peer's level to about 0.
  - `no-external-requests.spec.ts`: record every `page.on('request')` and `page.on('websocket')` URL through pre-join
    (blur and rnnoise on) and a short call. Every URL is same-origin or `blob:`/`data:`, and `/vendor/mediapipe/...`
    and `/vendor/rnnoise/...` were actually requested.
  - `rnnoise-offline.spec.ts`: `measureNoiseSuppression()` renders 5 s of seeded white noise at −30 dBFS RMS through the
    real RNNoise node in `OfflineAudioContext(1, 240000, 48000)`. Threshold (decision): input RMS − output RMS ≥ 10 dB
    over 1.0–5.0 s (the first second is warm-up); the output is finite and not all zeros; no `processorerror`.
  - `fallback.spec.ts`: `addInitScript` deletes `VideoFrame` and `AudioWorkletNode`; controls are disabled with the
    reason, the call works, no console errors.
  - `persistence.spec.ts`: choices survive a reload and are applied in pre-join for the same devices.

## Definition of Done
- [ ] [auto] Processors swap without republishing or dropping the track — evidence: `pnpm test:e2e -- media/blur-swap`,
      `pnpm test:e2e -- media/mic-chain`.
- [ ] [auto] The browser makes no external network requests — evidence:
      `pnpm test:e2e -- media/no-external-requests`.
- [ ] [auto] RNNoise lowers seeded white noise by ≥ 10 dB (OfflineAudioContext, threshold above) — evidence:
      `pnpm test:e2e -- media/rnnoise-offline`.
- [ ] [auto] Unsupported browsers get disabled controls with a reason and a working call — evidence:
      `pnpm test:e2e -- media/fallback`.
- [ ] [auto] Preferences persist per device — evidence: `app/lib/media/preferences.test.ts`,
      `pnpm test:e2e -- media/persistence`.
- [ ] [auto] The CPU warning follows its thresholds — evidence: `app/lib/media/cpu-monitor.test.ts`.
- [ ] [auto] No console errors or CSP violations — evidence: `pnpm test:e2e -- media` (base fixture).
- [ ] [auto] `lint`, `typecheck`, `test`, `build` and `check:english` are green — evidence: ci.yml.
- [ ] [agent-manual] `node scripts/vendor-assets.mjs` is idempotent, needs no network and fails clearly on a missing file
      or a model hash mismatch — evidence: output of two runs (one with the model renamed) in the report.
- [ ] [agent-manual] `/vendor/**/*.wasm` is served as `application/wasm` and `.js` as `text/javascript` — evidence:
      `curl -sI` output per file in the report.
- [ ] [user] Blur and noise suppression behave per the manual browser matrix (Chrome, Edge, Firefox, Safari macOS/iOS,
      Android Chrome: working, or disabled with a reason; no audio glitches) — evidence: `docs/TESTING.md` matrix rows.

## Notes and gotchas
- `@livekit/track-processors` defaults to jsDelivr (wasm) and storage.googleapis.com (model). Always pass `assetPaths`;
  CSP `connect-src 'self'` blocks the defaults anyway, and the base fixture fails on the violation.
- `@mediapipe/tasks-vision` stays exactly 0.10.14: track-processors 0.8 depends on it, and 1.x is reported to send
  telemetry. The vendor script enforces the version.
- The processor's frame ticker is a `blob:` worker, the only reason for `worker-src blob:`. `script-src` has no `blob:`,
  so the RNNoise worklet must be a same-origin file. Never add other `blob:` workers or worklets.
- WebAssembly compiles under `'wasm-unsafe-eval'`. If MediaPipe or RNNoise trips any other CSP rule, report it; never
  loosen the CSP locally.
- MediaPipe's wasm logs through Emscripten console hooks. If an INFO line lands on `console.error`, request an exact
  allowlist entry in `tests/e2e/fixtures/base.ts` (devops-ci) instead of muting console errors.
- A `.wasm` served with the wrong MIME type makes Emscripten fall back from streaming compilation with a console
  warning; check the headers.
- `switchTo` only changes transformer options and `setProcessor` swaps the sender track with `replaceTrack`. Anything
  that calls `unpublishTrack` or `publishTrack` for an effect is a bug.
- RNNoise processes 48 kHz frames of 480 samples. Never create a second AudioContext for the mic chain; use
  `ctx.media.audioContext()`. The recording mixer (Stage 08) has its own context and taps the processed mic track.
- Firefox and Safari use the processor's `canvas.captureStream()` fallback; keep `maxFps` at 30 or lower.
- Headless CI renders WebGL2 with SwiftShader: blur is slow but works. Assert continuity, never frame rates.
- Heavy runs: `sh scripts/with-lock.sh pnpm test:e2e -- media`. Worktree: `node scripts/worktree-setup.mjs media-fx
  <port>` (it runs the vendor script once it exists).
