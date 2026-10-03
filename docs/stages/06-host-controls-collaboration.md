# Stage 06 — Host controls and collaboration

Status: todo
Owner(s): `collab-ui` (Wave 2)
Depends on: Stage 04 backend (`rooms-backend`: every `/api/calls/:roomId/**` route except recording, `blinq.srv.v1`
hints, `publishRoomState`), Stage 05 (`call-core`: `CallContext`, registries, `messaging`, `/dev/call` harness)
Blocks: Stage 10 (real-flow E2E, security review)

## Goal
Hosts and co-hosts moderate a live meeting from the call UI: a waiting-room panel, a participants panel with roles,
states, search and an ordered hand queue, per-participant actions (mute, give or take away voice, ask to unmute, volume
for everyone, rename, co-host, lower hand, remove) and room-wide actions (mute all, lock, live settings, end for all).
Everyone gets end-to-end encrypted chat, reactions and raise hand. Each capability is a feature folder registered with
`defineCallFeature`. The server APIs already exist (Stage 04), so this stage is UI and integration only: the UI shows
what `canPerform()` allows, and the server stays the only enforcement point.

## Scope
### In scope
- Features `participants`, `lobby`, `hands`, `host-actions`, `room-settings`, `chat`, `reactions`, each in
  `app/lib/call/features/<feature>/` with components in `app/components/call/<folder>/`.
- The participant side of moderation: ask-to-unmute prompt (never forced), "the host muted you" and permission notices,
  rename self, removed and ended notices.
- The host prompt to rotate the room key after a removal.
- E2E coverage of every host action against the real Stage 04 APIs.
### Out of scope (and where it lives instead)
- Server routes, permission checks, LiveKit calls and hints: Stage 04 (`rooms-backend`). collab-ui never edits
  `server/**`; a server bug becomes a request in the report, with a failing test when possible.
- Core call UI (tiles incl. the hand badge, control bar host, mic/camera/screen-share buttons, phase handling, hotkeys):
  Stage 05 (`call-core`).
- `/m/[slug]`, join error screens (`JOIN_REMOVED`, `ROOM_LOCKED`) and the room settings page with "Rotate key": Stage 04
  (`rooms-ui`).
- Recording controls and the REC indicator: Stage 08 (`recording-client`).
- Chat history for late joiners, private messages, mid-call key rotation: backlog.

## Owned paths
- `app/lib/call/features/{participants,lobby,hands,host-actions,room-settings,chat,reactions}/**` (colocated
  `*.test.ts` included)
- `app/components/call/{participants,lobby,chat,reactions,host}/**`
- `tests/e2e/collab/**`
### Consumes (must not edit)
- `app/lib/contracts/call.ts` (`CallContext`, `defineCallFeature`, `ControlBarItem`, `SidePanel`, `TileBadge`,
  `SettingsSection`, `ParticipantView`, `AppMessaging`, `CallEventMap`), `app/lib/contracts/test-hooks.ts`
- `shared/schemas/calls.ts` (`renameSchema`, `handSchema`, `muteSchema`, `permissionsSchema`, `volumeSchema`,
  `roleChangeSchema`, `muteAllSchema`, `liveSettingsSchema`, `LobbyEntry`, `CallParticipantInfo`),
  `shared/schemas/livekit.ts` (`chatBodySchema`, `CHAT_MAX_LENGTH`, `REACTIONS`, `reactionBodySchema`,
  `serverHintSchema`, `RoomMetadata`), `shared/schemas/common.ts` (`displayNameSchema`)
- `shared/utils/permissions.ts` (`canPerform`, `CallAction`, `CallActor`), `shared/utils/error-codes/index.ts`
  (`errorMessage`)
- call-core code outside the folders above (`app/lib/call/**`, `app/components/call/core/**`,
  `app/composables/call/**`),
  `app/components/ui/**`, `tests/e2e/fixtures/{base,livekit}.ts`, server-core's API test factories
  (`tests/api/_harness/`), `app/lib/e2ee/keys.ts`, `docs/API.md` §7 and §12

## Tasks
### Requests to the orchestrator (resolved in Wave 1)
- [x] End notices: `CallFeature.phaseScreens` (`PhaseScreen { id, phases, order, component }`,
      `app/lib/contracts/call.ts`). `CallView` renders the highest-order screen for the phase; the core end screen has
      order 0, so `EndNotice` registers for `removed` and `ended` with order ≥ 1. Side panels are `CallFeature.panels`.
- [x] Shared E2E fixture: the DB-backed `rooms` fixture in `tests/e2e/fixtures/join.ts` (`docs/TESTING.md` §6.4)
      replaces the planned `real-join.ts`. Local spec helpers go in `tests/e2e/collab/helpers.ts`.
- [x] call-core's mic and camera buttons follow `canPublishSources` (disabled with "The host turned off your
      microphone/camera"), and revoked sources are switched off locally. collab-ui adds only the other notices.
- Feature `setup(ctx)` runs when the call session is created (pre-join), before the room connects.
### Shared plumbing
- [ ] `app/lib/call/features/host-actions/actions.ts`: typed wrappers over `ctx.callApi` for every route in
      `docs/API.md` §7, bodies built with the shared schemas. Errors map through `errorMessage(data.code)` to a
      `vue-sonner` toast; `404 NOT_FOUND` on a target means "they left" → toast and participant refetch.
- [ ] `app/lib/call/features/participants/useParticipantInfo.ts`: `GET /participants` → `{ items: CallParticipantInfo[] }`
      for the allowances `ParticipantView` lacks (`micAllowed`, `cameraAllowed`, `volumeLevel`). Refetch on panel open,
      on `server.hint` `participant.changed`, after each own action and on `participant.joined/left` (debounced 200 ms).
- [ ] The `canPerform` actor is `{ identity, role, kind }` from `ctx.self`; targets come from `ParticipantView`.
### Participants panel (`participants`)
- [ ] SidePanel `participants` ("People", count badge) → `app/components/call/participants/ParticipantsPanel.vue`: name,
      "Host" / "Co-host" / "Guest" badges, mic, camera and screen-share state, speaking and connection quality, hand
      state, a "media blocked" warning when `mediaEncrypted` is false, a "(you)" marker.
- [ ] Sections: raised hands (queue, below), then host, co-hosts, everyone else by name (`localeCompare`).
- [ ] Search filters by name (case-insensitive, NFKC-normalized, trimmed); pure `list.ts` (`sortParticipants`,
      `filterParticipants`).
- [ ] Own row: "Rename" (dialog validated with `displayNameSchema`, `POST /me/name`); other rows: the host-actions menu.
- [ ] Tile badges (`tileBadges`): role badge for host and co-hosts, "Guest" badge for guests.
### Waiting room (`lobby`)
- [ ] SidePanel `lobby` ("Waiting room"), `visible` = `canPerform(self, 'lobby.view')`, badge = waiting count →
      `app/components/call/lobby/LobbyPanel.vue`: entries from `GET /lobby` ordered by `requestedAt`, "Guest" badge,
      Admit, Deny and Admit all (`POST /lobby/admit-all` → toast with `admitted`).
- [ ] Refetch on `server.hint` `lobby.changed` (debounced 150 ms), on panel open, after each decision and every 10 s while
      entries exist, as a fallback for a lost hint (decision). A 404 or 409 on admit/deny (another moderator decided
      first) only refetches.
- [ ] A new waiting person raises a moderator toast with an "Admit" action (stacked into one toast above 3 people).
- [ ] Pure `lobby-store.ts`: merge fetched lists, dedupe by `requestId`, stable order.
### Hands (`hands`)
- [ ] ControlBarItem `raise-hand` (everyone): toggles `POST /me/hand { raised }` based on `self.handRaisedAt`.
- [ ] Pure `queue.ts`: participants with `handRaisedAt`, ascending by the server-set `hand` time, ties by identity.
- [ ] `app/components/call/participants/HandQueue.vue`: numbered positions; moderators get "Allow to speak" and "Lower
      hand" (`POST /participants/:identity/lower-hand`); a participant sees their own position.
- [ ] "Allow to speak" (decision) = `POST permissions { microphone: true }` → `POST lower-hand` → `POST ask-unmute`.
- [ ] Moderator toast "<name> raised their hand", at most one per 5 s (summarized beyond that).
### Host actions (`host-actions`)
- [ ] Pure `menu.ts`: `participantMenu(actor, target, info)` → ordered items, each gated by `canPerform(actor, action,
      target)` plus state: Mute microphone / Stop camera / Stop screen share (`mute` with `source`), Ask to unmute
      (`ask-unmute`, only while muted), Allow or take away microphone and camera (`permissions`, "give voice"), Volume
      for everyone (`volume`, slider 0–100 %, sent on release), Rename (`name`), Make co-host / Remove co-host (`role`),
      Lower hand (`lower-hand`), Remove from meeting (`remove`).
- [ ] `app/components/call/host/ParticipantActionsMenu.vue` (DropdownMenu), used by the participants panel and by a tile
      badge that renders only for moderators.
- [ ] Remove: AlertDialog "Remove <name>? They cannot rejoin this meeting." On success the host (role `host`) gets a
      persistent toast "People you remove still know this meeting's key. Rotate it in the room settings after the
      meeting." linking to `/rooms/<roomId>`; co-hosts get "Ask the host to rotate the room key after the meeting."
      The reminder stays in the host controls menu until the call ends.
- [ ] Participant side (feature `setup`, via `ctx.events` and `ctx.room`): `server.hint` `ask-unmute` → dialog "The host
      asks you to unmute" with [Unmute] [Stay muted]; only the click calls
      `localParticipant.setMicrophoneEnabled(true)`. A local track muted by the server → "The host muted your
      microphone" (or camera, screen share). `ParticipantPermissionsChanged` → "The host turned off your microphone" /
      "You can unmute now".
- [ ] End notices `app/components/call/host/EndNotice.vue`: `removed` → "You were removed from this meeting. You cannot
      rejoin it."; `ended` → "The host ended the meeting for everyone." (a `phaseScreens` entry, order ≥ 1).
### Room controls and live settings (`room-settings`)
- [ ] ControlBarItem `host-controls` (placement `end`, `visible` for moderators) →
      `app/components/call/host/HostControlsMenu.vue`: Lock meeting (`call.lock`); Waiting room, Screen share (everyone
      or hosts only), Let participants unmute themselves, Chat (all `call.settings`, host only); Mute all with a
      "Prevent self-unmute" checkbox (`call.muteAll`); End meeting for all (`call.end`, AlertDialog).
- [ ] Changes go through `PATCH /settings` (`liveSettingsSchema`, one field per request). The displayed value is
      `ctx.roomState` (server truth); a switch shows a pending state until the `{ state }` response or the metadata
      update confirms it, and reverts with a toast on failure.
- [ ] Pure `controls.ts`: which controls an actor sees (co-hosts: lock and mute all only).
### Chat (`chat`)
- [ ] SidePanel `chat` ("Chat"), badge = unread count while the panel is closed →
      `app/components/call/chat/ChatPanel.vue`.
- [ ] Send: validate with `chatBodySchema`, then `ctx.messaging.send('chat', { text })`; live counter and hard stop at
      `CHAT_MAX_LENGTH` (2000); Enter sends, Shift+Enter inserts a newline, IME composition is respected; own messages
      are appended after `send` resolves (LiveKit never echoes them); failures show inline with Retry.
- [ ] Receive: `ctx.messaging.on('chat', …)`. The messaging layer already drops NONE-encrypted packets, unknown or
      mismatched senders and duplicate ids; the feature re-validates bodies with `chatBodySchema`, caps each sender at
      20 messages per 10 s (decision), keeps at most 500 messages, orders by arrival and shows the sender `ts` clamped to
      receive time ± 5 min.
- [ ] `roomState.chatEnabled === false`: input disabled ("The host turned off chat") and incoming chat dropped
      (decision).
- [ ] Text-only rendering: pure `linkify.ts` splits text into text and link segments; links only for `http:`/`https:`
      URLs accepted by `new URL()`, trailing punctuation trimmed, rendered as `<a target="_blank" rel="noopener
      noreferrer">`; bidi override and isolate controls (U+202A–U+202E, U+2066–U+2069) removed (decision);
      `white-space: pre-wrap` with long-word wrapping. No `v-html`, no markdown.
- [ ] Auto-scroll unless the reader scrolled up (then a "New messages" pill); `aria-live="polite"` on new messages.
### Reactions (`reactions`)
- [ ] ControlBarItem `reactions` (placement `center`) → popover with the six `REACTIONS`;
      `ctx.messaging.send('reaction', { reaction })`, at most 3 per second.
- [ ] `app/components/call/reactions/ReactionsOverlay.vue`, teleported to `body` by the control-bar item (fixed layer,
      `pointer-events: none`): emoji plus sender name for about 3 s, at most 20 on screen; bodies checked with
      `reactionBodySchema`; per-sender limit in pure `limiter.ts`; `prefers-reduced-motion` → fade only. Emoji glyphs
      are written as `\u{…}` escapes (decision). If the control bar unmounts `center` items on phones, request an
      overlay slot.
- [ ] Tile badge: the sender's latest reaction on their tile for 3 s.
### Test helpers
- [ ] Specs use the shared `rooms` fixture (`tests/e2e/fixtures/join.ts`): users with sessions, `POST /api/rooms`,
      invites, `POST /api/join/:slug`, `waitForAdmission` over the SSE, then `/dev/call#…` from `harnessPath()`.
      Shared spec helpers (open the harness, click Join, wait for `inCall`) live in `tests/e2e/collab/helpers.ts`.
- [ ] Wire capture for the chat spec, as a test-only `page.addInitScript` (never app code): wrap
      `RTCDataChannel.prototype.send` and the `message` events of every data channel to record payload bytes.

## Tests
- Unit (colocated): `app/lib/call/features/host-actions/menu.test.ts` (table-driven over actor role × kind × target
  role × target state: an item exists exactly when `canPerform` allows it; nothing targets yourself or the host;
  co-hosts never get Make co-host), `app/lib/call/features/room-settings/controls.test.ts`,
  `app/lib/call/features/hands/queue.test.ts` (order by time, ties, lowered hands leave, re-raise goes last),
  `app/lib/call/features/participants/list.test.ts` (sections, sort, search with non-ASCII names written as `\u`
  escapes), `app/lib/call/features/lobby/lobby-store.test.ts`, `app/lib/call/features/chat/linkify.test.ts`
  (`javascript:`, `data:`, `vbscript:`, mixed-case schemes, `https://a.b/"><img src=x onerror=…>`, trailing
  punctuation, a 2000-character input in linear time), `app/lib/call/features/chat/chat-store.test.ts` (validation,
  2000 limit, per-sender cap, 500 cap, unread count, chat disabled), `app/lib/call/features/reactions/limiter.test.ts`.
- API: none. Server authorization and effects are Stage 04's `tests/api/calls/{authz,actions}.test.ts`.
- E2E (`tests/e2e/collab/`, Chromium; `host-actions` and `chat` also on Firefox):
  - `host-actions.spec.ts`: host mutes a participant's mic (peer sees it ≤ 1 s); stops their camera (≤ 1 s; they can
    turn it back on); takes away the mic (button and M hotkey cannot unmute, peers see the mic off for 2 s); ask to
    unmute shows the prompt and changes nothing until clicked; rename, co-host assign and lower hand reach every peer
    ≤ 1 s; remove → removed notice for the target, rotate-key prompt for the host, rejoin rejected with `JOIN_REMOVED`;
    end for all → every client reaches `ended`.
  - `hands.spec.ts`: three participants raise hands in a known order → the host's queue matches; allow to speak → the
    participant unmutes and peers see the mic on.
  - `volume.spec.ts`: volume for everyone 25 % → a third peer's playback volume for that participant equals 0.25 × its
    local volume (call-core audio state in `window.__blinqTest.state`, or the attached `<audio>` element).
  - `chat.spec.ts`: a random marker never appears in captured data-channel payloads (and captures are non-empty); XSS
    payloads (`<img src=x onerror=…>`, `<script>`, a `javascript:` link) render as literal text, `window.__xss` stays
    undefined, only `http(s)` links become anchors with `rel="noopener noreferrer"`; unread badge; 2000-character
    limit; chat disabled.
  - `lobby.spec.ts`: a waiting guest appears in the host's panel ≤ 1 s after its join request; admit (the guest
    connects), deny, admit all.
  - `room-settings.spec.ts`: lock → a new join gets `ROOM_LOCKED`; "hosts only" hides the participant's share button;
    self-unmute off; every setting reaches all peers' `roomState` ≤ 1 s.
  - `permissions-ui.spec.ts`: participants and guests see no moderator controls; a co-host lacks host-only items and
    has no actions on the host.
  - `reactions.spec.ts`: a reaction shows on peers; a burst is capped.
  - `responsive.spec.ts` (`@responsive`): panels, menus and dialogs at 375/768/1440 px without horizontal overflow.

## Definition of Done
- [ ] [auto] Authorization matrix: the UI offers an action only when `canPerform` allows it — evidence:
      `app/lib/call/features/host-actions/menu.test.ts`, `app/lib/call/features/room-settings/controls.test.ts`,
      `pnpm test:e2e -- collab/permissions-ui`; server side: `tests/api/calls/authz.test.ts` (Stage 04).
- [ ] [auto] A host action reaches the peer in ≤ 1 s — evidence: `pnpm test:e2e -- collab/host-actions`.
- [ ] [auto] A revoked mic cannot unmute — evidence: `pnpm test:e2e -- collab/host-actions`.
- [ ] [auto] The host turns a participant's camera off — evidence: `pnpm test:e2e -- collab/host-actions`.
- [ ] [auto] Ask to unmute never unmutes without the participant's click — evidence:
      `pnpm test:e2e -- collab/host-actions`.
- [ ] [auto] Raise hand → allow to speak → the participant unmutes — evidence: `pnpm test:e2e -- collab/hands`.
- [ ] [auto] Volume for everyone is applied by receivers — evidence: `pnpm test:e2e -- collab/volume`.
- [ ] [auto] Chat is ciphertext on the wire and an XSS payload renders as text — evidence:
      `pnpm test:e2e -- collab/chat`, `app/lib/call/features/chat/linkify.test.ts`.
- [ ] [auto] The hand queue is ordered by raise time — evidence: `app/lib/call/features/hands/queue.test.ts`,
      `pnpm test:e2e -- collab/hands`.
- [ ] [auto] A waiting person appears for moderators ≤ 1 s; admit, deny and admit all work — evidence:
      `pnpm test:e2e -- collab/lobby`.
- [ ] [auto] Live settings reach everyone ≤ 1 s and a locked room rejects joins — evidence:
      `pnpm test:e2e -- collab/room-settings`.
- [ ] [auto] Removal shows the removed notice and the rotate-key prompt; end for all ends every client — evidence:
      `pnpm test:e2e -- collab/host-actions`.
- [ ] [auto] No horizontal overflow at 375/768/1440 px — evidence: `pnpm test:e2e -- collab/responsive`.
- [ ] [auto] No console errors or CSP violations — evidence: `pnpm test:e2e -- collab` (base fixture).
- [ ] [auto] `lint`, `typecheck`, `test`, `build` and `check:english` are green — evidence: ci.yml.
- [ ] [agent-manual] Only owned paths changed and every feature appears without editing core files — evidence:
      `git diff --stat <waveBaseSha>...HEAD` in the report.
- [ ] [user] Moderation, chat and reactions work in Safari (macOS, iOS) and Android Chrome — evidence: manual browser
      matrix in `docs/TESTING.md`.

## Notes and gotchas
- `blinq.srv.v1` hints arrive unencrypted and anyone able to inject packets could fake one. React only by refetching,
  or for `ask-unmute` by showing a prompt. Never act destructively on a hint.
- `canPerform` in the UI is presentation. Always expect 403 `CALL_FORBIDDEN` or `CALL_NOT_PARTICIPANT` and show
  `errorMessage(code)`.
- Targeted actions never apply to yourself or the host (`canPerform` returns false); self actions use `/me/*`.
- Attributes (`hand`, `vol`, `role`) and names arrive through LiveKit shortly after the API returns. Don't mutate
  `ParticipantView` optimistically; show pending states instead.
- LiveKit refuses to publish a source missing from `canPublishSources`, so `setMicrophoneEnabled(true)` after a revoke
  rejects. Catch it and show the notice instead of an error.
- "Allow to speak" while self-unmute is off relies on the per-person grant overriding the room policy (Stage 04 token
  and permission builder, `docs/API.md` §12). If the merged server does not do that, request the fix.
- Chat is E2EE, so the server cannot moderate it and "chat off" holds only for well-behaved clients (documented
  limitation). Late joiners see no earlier messages.
- A removed participant still holds K until the host rotates it (`docs/SECURITY.md` §3.5); that is the reason for the
  prompt.
- Non-ASCII test data (names, bidi characters) is written as `\u` escapes; `pnpm check:english` rejects Cyrillic.
- Timing checks use `expect.poll(…, { timeout: 1000 })` started at the click; page setup is not part of the budget.
- Heavy Playwright runs go through `sh scripts/with-lock.sh pnpm test:e2e -- collab`; set up the worktree with
  `node scripts/worktree-setup.mjs collab-ui <port>`.
