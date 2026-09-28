# Stage 05 — Call core

Status: todo
Owner(s): `call-core` (Wave 1)
Depends on: Stage 01 (`app/lib/contracts/{call,test-hooks}.ts`, `app/lib/e2ee/**`, `shared/schemas/livekit.ts`, UI shell)
Blocks: Stage 04 frontend (`rooms-ui`), Stage 06 (`collab-ui`), Stage 07 (`media-fx`), Stage 08 (`recording-client`)

## Goal
An end-to-end encrypted call works between browsers: pre-join with preview and devices, fast join, grid and speaker
views, screen share, reconnect handling, the E2EE badge with a safety code, and hotkeys. Unencrypted media is never
subscribed, attached, mixed or recorded. `CallContext` (from `app/lib/contracts/call.ts`) and the feature registries
let Wave 2 agents add controls, panels, badges, pre-join slots and settings sections by adding files only. A test-only
harness drives calls from Playwright without the rooms UI.

## Scope
### In scope
- Room factory with E2EE, per-meeting keys, subscription policy and manager, audio engine, connect flow, fast-join marks.
- Pre-join, call view (grid, speaker, pin, active speaker, quality, muted icons, hand badge), control bar, screen share,
  reconnect banner, E2EE badge and safety code, in-call Invite button, hotkeys and help.
- `CallContext` implementation: `messaging` (encrypted app messages), `subscriptions`, `audio`, `media`, `events`,
  `callApi`; registries via `import.meta.glob`.
- Harness `/dev/call` (`app/dev/CallHarness.vue`), `window.__blinqTest` hooks, Playwright `joinAs(role)` fixture.
### Out of scope (and where it lives instead)
- Join APIs and the `/m/[slug]` flow: Stage 04 (`rooms-backend`, `rooms-ui`); `rooms-ui` embeds these components.
- Host-control UI, lobby panel, participants panel, chat and reaction UI, hand queue: Stage 06 (`collab-ui`), built on
  `CallContext.messaging` and `callApi`.
- Blur, RNNoise and processors (`app/lib/media/**`): Stage 07 (`media-fx`), through `CallContext.media`.
- Recording compositor and uploads: Stage 08 (`recording-client`), through `subscriptions.setDemand` and
  `audio.remoteAudioTracks()`.

## Owned paths
- `app/dev/**`, `app/components/call/**` (except the Wave-2 folders `participants`, `lobby`, `chat`, `reactions`,
  `host`, `effects`, `recording`), `app/lib/{livekit,layout}/**`, `app/lib/call/**` (except Wave-2 feature folders),
  `app/stores/call*.ts`, `app/composables/call/**`
- `tests/e2e/call/**`, `tests/e2e/fixtures/livekit.ts`
### Consumes (must not edit)
- `app/lib/contracts/{call,test-hooks}.ts`, `app/lib/e2ee/**` (`deriveMeetingKeys`, `sealAppMessage`,
  `openAppMessage`, `buildRoomLink`), `shared/schemas/{livekit,join,calls,rooms,settings}.ts`,
  `shared/utils/display-name.ts`, `shared/utils/permissions.ts`
- `app/composables/useApi.ts`, `app/layouts/call.vue`, `app/components/ui/**`, `tests/e2e/fixtures/base.ts`, `docs/API.md`

## Tasks
### Room, E2EE and keys
- [ ] `app/lib/livekit/room-factory.ts`: `new Room({ adaptiveStream: false, dynacast: true, encryption: { keyProvider,
      worker }, publishDefaults, videoCaptureDefaults, audioCaptureDefaults })`, `worker` from
      `import E2EEWorker from 'livekit-client/e2ee-worker?worker'`, `keyProvider = new ExternalE2EEKeyProvider({ keySize:
      256 })`.
- [ ] `publishDefaults`: `videoCodec: 'vp8'`, `simulcast: true` (false on Safari < 17.2), `backupCodec: false`,
      `red: false`, `dtx: true`, simulcast layers `h180` and `h360` under the camera preset.
- [ ] `app/lib/livekit/support.ts`: `isE2EESupported()` gate and the Safari version check; unsupported browsers reach
      the `error` phase with an "unsupported browser" reason and never connect unencrypted.
- [ ] Keys: `deriveMeetingKeys(K, epoch, slug)` → `keyProvider.setKey(mediaKey)`; `chatKey` kept for `messaging`;
      `safetyCode` for the badge.
- [ ] `app/lib/livekit/connect.ts`: `await room.setE2EEEnabled(true)` before `room.connect(url, token,
      { autoSubscribe: false })`, then subscribe and publish the pre-acquired tracks in parallel.
- [ ] `app/composables/call/useCall.ts` returns `CallContext`; LiveKit objects kept in `shallowRef`/`markRaw`; state in
      `app/stores/call.ts`; `ParticipantView` built from attributes (`role`, `kind`, `hand`, `vol`) validated with
      `participantAttributesSchema`; `roomState` parsed with `roomMetadataSchema` (invalid metadata ignored).
- [ ] Decryption failures (`EncryptionError`) mark the tile "cannot decrypt"; `phase` follows `CallPhase`.
### Subscriptions and audio
- [ ] `app/lib/livekit/subscription-policy.ts` (pure): input = remote publications (source, `encryptionType`,
      dimensions), layout page, tile pixel sizes, visibility (IntersectionObserver + `document.visibilityState`),
      pin, screen share, demands from `setDemand`; output per track `{ subscribed, enabled, width, height }`. A
      publication with `encryptionType` NONE is never subscribed and emits `unencrypted.blocked`.
- [ ] `app/lib/livekit/subscription-manager.ts`: applies the diff with `setSubscribed`, `setEnabled`,
      `setVideoDimensions`; implements `SubscriptionControl.setDemand(sourceId, demands)`.
- [ ] `app/lib/livekit/audio-engine.ts` implements `AudioControl`: one `<audio>` element per subscribed remote audio
      track (kept attached even when a mixer taps the track); volume = `setLocalVolume` value × host `vol` / 100;
      `room.startAudio()` on a user gesture when playback is blocked; output device selection only where
      `supportsAudioOutputSelection()`; `remoteAudioTracks()` returns encrypted-verified tracks only.
- [ ] `app/lib/livekit/audio-context.ts`: one shared 48 kHz `AudioContext` set on local audio tracks via
      `track.setAudioContext`; mic `GainNode` for `setMicGain`; `MediaControl` exposes it to `media-fx`.
### Messaging and events
- [ ] `app/lib/call/messaging.ts` implements `AppMessaging`: `send` seals with `sealAppMessage` and publishes reliable
      data on `blinq.chat.v1` / `blinq.reaction.v1` (`to` → `destinationIdentities`); receive drops packets with
      `encryptionType` NONE, unknown senders, `openAppMessage` failures (sender mismatch) and duplicate ids.
- [ ] `blinq.srv.v1`: accepted only from the server (no sender participant), parsed with `serverHintSchema`, emitted
      as `server.hint` (features refetch through `callApi`). No RPC methods are registered.
- [ ] `app/lib/call/event-bus.ts` implements `CallEventBus` with `CallEventMap`.
- [ ] `callApi(path, options)`: `useApi()` bound to `/api/calls/:roomId`.
### Pre-join and fast join
- [ ] `app/components/call/core/PreJoin.vue`: camera preview, mic meter (analyser on the shared context), device
      selection (enumerate, `devicechange`, permission states), display name for guests (`displayNameSchema`), "join
      with mic off" / "join with camera off" (forced off when the room has `muteOnJoin`), REC notice, `preJoin` slots
      from the registry.
- [ ] Track reuse: tracks created in pre-join are the ones published on join.
- [ ] Fast join: SDK and worker loaded when pre-join mounts, `room.prepareConnection(livekitUrl)` as soon as config is
      known, keys derived before the click; marks `blinq:join:click`, `blinq:join:connected`,
      `blinq:join:first-remote-frame` (via `requestVideoFrameCallback`) copied into `testHooks().metrics`.
- [ ] Camera capture capped by `media.maxCameraResolution` from `GET /api/config`.
### Views and controls
- [ ] `app/lib/layout/grid.ts` (pure): `computeGrid({ count, width, height, phone })` → `{ cols, rows, tileWidth,
      tileHeight, pageSize, pages }`; at most 5×5; phones page at 6 tiles (2×3) (decision); 16:9 tiles.
- [ ] `app/components/call/core/{CallView,VideoGrid,SpeakerView,ParticipantTile,ControlBar,ReconnectBanner,E2EEBadge,
      SafetyCodeDialog,InviteButton,HotkeyHelp,DeviceMenu,ScreenShareButton,PreJoin}.vue`.
- [ ] Tiles: active-speaker ring, connection-quality icon, muted icons, hand badge (`handRaisedAt`), "unencrypted media
      blocked" warning, `tileBadges` from the registry; pin (local) and speaker view feed the subscription policy.
- [ ] Screen share: `h720fps5`, `h720fps15`, `h720fps30`, `h1080fps15`, `h1080fps30`, capped by
      `media.maxScreenShareResolution` / `media.maxScreenShareFps`; `contentHint` `detail` at ≤ 15 fps, `motion` at 30
      (decision); optional tab/system audio (`screen_share_audio`); hidden on iOS/Android and for participants when
      `screenSharePolicy = 'hosts'`.
- [ ] Reconnect banner on `Reconnecting`/`SignalReconnecting`, cleared on `Reconnected`; `Disconnected` reasons mapped
      to `removed` / `ended` / `left`.
- [ ] E2EE badge green only when E2EE is on and every remote publication is encrypted; dialog shows `safetyCode`
      ("ABCD-EFGH-JKMN-PQRS") and says it proves only "same key".
- [ ] In-call Invite button (host and co-hosts): `POST /api/rooms/:id/invites` (`expiresIn: '24h'`) and copy
      `buildRoomLink(publicUrl, slug, K, token)`.
- [ ] Hotkeys (`app/lib/call/hotkeys.ts` pure matcher + `app/composables/call/useHotkeys.ts`): M and V use `e.key` when it
      is a Latin letter, else `e.code` `KeyM`/`KeyV`; Space = push-to-talk while muted (`e.code`), ignored in inputs,
      textareas, contenteditable, during IME composition and with modifiers, `preventDefault` including repeats,
      released on `blur` and when the page becomes hidden; `?` opens help.
### Registries, harness and fixtures
- [ ] `app/lib/call/registry.ts`: `import.meta.glob('./features/*/index.ts', { eager: true })`; default exports are
      `CallFeature`s; entries sorted by `order`; duplicate ids throw in dev; `setup(ctx)` called once per call with
      cleanup; the core controls register through `app/lib/call/features/core/index.ts`.
- [ ] `app/dev/CallHarness.vue` (`/dev/call`, dev and test builds only): reads `url`, `token`, `k`, `epoch`, `slug`,
      `name`, `e2ee` from the fragment and runs pre-join + call without the rooms UI (decision).
- [ ] Test hooks via `testHooks()`: `metrics`; `useFakeScreenSource(true)` returns a 1920×1080 canvas `captureStream`
      instead of `getDisplayMedia`; `publishUnencryptedTrack()` (available in a harness client joined with `e2ee=off`)
      (decision); `state.subscriptions` (policy output incl. requested sizes) and `state.inboundVideo` (`getStats`
      frame size and `framesDecoded` per remote track).
- [ ] `tests/e2e/fixtures/livekit.ts`: `joinAs(role, { name, room })` creates the LiveKit room with the server SDK, mints
      a token with `livekit-server-sdk` using the grants table in `docs/API.md` (switch to `buildParticipantToken` once
      `rooms-backend` merges) (decision), generates K and epoch, and opens `/dev/call#…`.

## Tests
- Unit: `app/lib/layout/grid.test.ts` (1..25 on desktop and phone sizes), `app/lib/call/hotkeys.test.ts` (Latin keys;
  a Cyrillic layout built with `String.fromCodePoint` and `e.code` `KeyM`/`KeyV`; Space press, repeat, release, blur;
  inputs and IME ignored), `app/lib/livekit/subscription-policy.test.ts` (NONE never subscribed; hidden and off-page
  tiles; small tiles request ≤ 320 px; pin and screen-share priority; demands), `app/lib/livekit/audio-engine.test.ts`
  (volume math, `vol` parsing), `app/lib/call/messaging.test.ts` (drops NONE, unknown sender, sender mismatch,
  duplicates, participant-sent `blinq.srv.v1`), `app/lib/call/registry.test.ts`, `app/lib/livekit/support.test.ts`.
- API: none.
- E2E: `tests/e2e/call/e2ee.spec.ts` (Chromium ↔ Firefox, both see and hear, badge green),
  `tests/e2e/call/unencrypted-blocked.spec.ts`, `tests/e2e/call/wrong-key.spec.ts` (`framesDecoded` stays 0),
  `tests/e2e/call/join-time.spec.ts`, `tests/e2e/call/layers.spec.ts` (small tile ≤ 320 wide),
  `tests/e2e/call/screen-share.spec.ts` (1920×1080 source honored at the preset), `tests/e2e/call/hotkeys.spec.ts`,
  `tests/e2e/call/responsive.spec.ts` (`@responsive`; 375/768/1440), `tests/e2e/call/reconnect.spec.ts`.

## Definition of Done
- [ ] [auto] A Chromium ↔ Firefox call works with E2EE — evidence: `pnpm test:e2e -- call/e2ee`.
- [ ] [auto] An unencrypted publisher is blocked (test hook) — evidence: `pnpm test:e2e -- call/unencrypted-blocked`.
- [ ] [auto] A wrong-key peer gets no frames — evidence: `pnpm test:e2e -- call/wrong-key`.
- [ ] [auto] Join (click → first remote frame) is < 6 s on the PR gate; nightly p95 < 3 s — evidence:
      `pnpm test:e2e -- call/join-time`, nightly.yml.
- [ ] [auto] A small tile receives width ≤ 320 (layer switching) — evidence: `pnpm test:e2e -- call/layers`.
- [ ] [auto] A 1920×1080 canvas test source is honored — evidence: `pnpm test:e2e -- call/screen-share`.
- [ ] [auto] Grid calculation is unit-tested for 1..25 — evidence: `app/lib/layout/grid.test.ts`.
- [ ] [auto] Hotkeys are tested, including a Cyrillic layout — evidence: `app/lib/call/hotkeys.test.ts`,
      `pnpm test:e2e -- call/hotkeys`.
- [ ] [auto] No horizontal overflow; the control bar stays in the viewport at 375/768/1440 px — evidence:
      `pnpm test:e2e -- call/responsive`.
- [ ] [auto] No console errors or CSP violations — evidence: `pnpm test:e2e -- call` (base fixture).
- [ ] [auto] The policy never subscribes an unencrypted publication — evidence:
      `app/lib/livekit/subscription-policy.test.ts`.
- [ ] [auto] Unencrypted, spoofed or duplicate app messages are dropped — evidence: `app/lib/call/messaging.test.ts`.
- [ ] [auto] The prod build has no `__blinqTest` and `/dev/call` returns 404 — evidence: ci.yml build job.
- [ ] [auto] The reconnect banner appears and clears — evidence: `pnpm test:e2e -- call/reconnect`.
- [ ] [auto] `lint`, `typecheck`, `test` are green — evidence: ci.yml.
- [ ] [agent-manual] A folder added under `app/lib/call/features/` shows up without editing core files — evidence:
      `app/lib/call/registry.test.ts` plus a local check described in the report.
- [ ] [user] Speaker selection appears only where supported (not Safari, iOS, Android) — evidence: manual browser matrix
      in `docs/TESTING.md`.

## Notes and gotchas
- `setE2EEEnabled(true)` must run before `connect`, or the first packets leave unencrypted.
- With E2EE, AV1, backup codecs and RED are unusable; keep VP8 simulcast. Safari < 17.2 publishes without simulcast.
- `autoSubscribe: false` is what makes blocking unencrypted media enforceable; never turn it on.
- `adaptiveStream` stays off so the subscription manager alone picks layers (deterministic tests).
- Server hints have `encryptionType` NONE by design (the server has no key); accept them only from the server.
- Keep remote audio elements attached when a mixer taps a track (Chrome bug 40094084).
- Hotkey tests must not contain literal Cyrillic characters (CI fails); use `String.fromCodePoint`.
- The E2EE worker is bundled same-origin (`worker-src 'self' blob:`); never load it from a CDN.
- Playwright runs 1 worker against the shared dev LiveKit; heavy runs go through `scripts/with-lock.sh`.
