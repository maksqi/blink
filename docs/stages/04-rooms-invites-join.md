# Stage 04 — Rooms, invites, join, E2EE keys

Status: todo
Owner(s): `rooms-backend` (Wave 1), `rooms-ui` (Wave 2)
Depends on: Stage 01 (contracts, server core, UI shell); `rooms-ui` also needs Stage 02 (`auth`) and Stage 05
(`call-core`) merged
Blocks: Stage 03 (`admin`), Stage 06 (`collab-ui`), Stage 08 (`recording-server` in-call routes, `recording-client`),
Stage 10

## Goal
Signed-in users create persistent rooms or instant meetings whose slug and key K are generated in the browser; K never
reaches the server. Owners share host and invite links, and people join through `/m/<slug>` after the server has
checked the join proof, invite, guest policy, lock, password, capacity and removal state, with a waiting room where
configured. `rooms-backend` also delivers every in-call and host-action API, permission enforcement, the LiveKit
service, webhooks with enforcement and `publishRoomState`, so Stage 06 is UI-only.

## Scope
### In scope
- Backend: `/api/rooms/**`, `/api/join/**`, `/api/calls/**` (except recording), `POST /api/webhooks/livekit`, the
  `RoomServiceAdapter` implementation, token builder, meetings and epochs, guest sessions, lobby with SSE, resume, key
  rotation, limits.
- Frontend: dashboard, create room and instant meeting, room settings page, invite manager, key vault, the `/m/[slug]`
  flow up to handing off to `call-core`, error screens, duplicate-tab detection.
### Out of scope (and where it lives instead)
- Call UI (pre-join media, grid, controls, E2EE room setup): Stage 05 (`call-core`), embedded by `rooms-ui`.
- Host-control and collaboration UI (lobby panel, participants, chat, hands, "rotate key" prompt after a removal):
  Stage 06 (`collab-ui`).
- `POST /api/calls/:roomId/recording/{start,stop}`: Stage 08 (`recording-server`), using `canPerform`,
  `resolveCaller` and `publishRoomState`.
- Admin views of rooms and meetings: Stage 03. Mid-call key rotation: backlog.

## Owned paths
- `rooms-backend`: `server/api/{rooms,join,calls,webhooks}/**` (except `server/api/calls/[roomId]/recording/**`),
  `server/services/{rooms,invites,join,lobby,calls,meetings,livekit,guests}/**`, `server/tasks/rooms/**`,
  `tests/api/{rooms,join,calls,webhooks}/**`.
- `rooms-ui`: `app/pages/dashboard.vue`, `app/pages/rooms/**`, `app/pages/m/**`, `app/components/{rooms,join}/**`,
  `app/lib/e2ee/key-vault.ts` (+ test), `tests/e2e/{rooms,join}/**`; requested additions (decision):
  `app/lib/join/**` (pure join state machine) and `app/composables/rooms/**`.
### Consumes (must not edit)
- `shared/schemas/{common,rooms,join,calls,livekit,settings}.ts`, `shared/utils/{permissions,display-name}.ts`,
  `shared/utils/error-codes/index.ts`
- `server/contracts/index.ts` (`RoomServiceAdapter`, `ParticipantPermissionSpec`, `EventBus`, `BusEvent`,
  `PublishRoomState`, `Clock`), `server/utils/**`, `server/services/{session,settings,audit}/**`, `server/database/**`
- `app/lib/e2ee/{keys,fragment,encoding}.ts`, `app/lib/contracts/call.ts`, `app/composables/useApi.ts`,
  `app/composables/useAuth.ts`, `app/plugins/00.fragment.client.ts` (`$fragment`), `call-core` components and
  `app/composables/call/**`

## Tasks
### Backend (rooms-backend, Wave 1)
- [ ] `POST /api/rooms` (`createRoomSchema`: browser-generated `slug`, `name`, `proof`, `ephemeral`, optional
      `password` and settings): stores `sha256(proof)` as `join_proof_hash`, argon2 hash of the password; duplicate slug
      → 409 `CONFLICT` (the client retries with a new slug) (decision); `limits.maxRoomsPerUser` → 409
      `ROOM_LIMIT_REACHED`; `maxParticipants` clamped to `limits.maxParticipantsPerRoom`.
- [ ] `GET /api/rooms` (owned + co-hosted, `Paginated<RoomSummary>`), `GET /api/rooms/:id` (`RoomDetails`),
      `PATCH /api/rooms/:id` (`updateRoomSchema`, owner only; `password: null` clears it; a live meeting gets
      `publishRoomState`), `DELETE /api/rooms/:id` (soft delete, `deleteRoom` when live). Non-members get 404
      `ROOM_NOT_FOUND`; co-hosts calling owner-only routes get 403 `FORBIDDEN`.
- [ ] `PUT /api/rooms/:id/key` (`rotateRoomKeySchema`): new proof hash, `key_version + 1`; 409 `MEETING_LIVE` while a
      meeting is live.
- [ ] `POST /api/rooms/:id/cohosts` (`addCohostSchema`, existing enabled user) and `DELETE /api/rooms/:id/cohosts/:userId`
      (owner only) over `room_members` (role `cohost`).
- [ ] Invites (`server/services/invites/**`): token `base64url(inviteIdBytes(16) ‖ HMAC-SHA256(k_invite,
      inviteIdBytes)[0..16])`, `k_invite = HKDF(APP_SECRET, info "blinq/v1/invite")`, stored nowhere, verified in
      constant time; `GET` lists `RoomInvite[]` with re-derived tokens (owner and co-hosts); `POST`
      (`createRoomInviteSchema`) → `{ invite: RoomInvite }`; `DELETE` sets `revoked_at`; consume with
      `UPDATE room_invites SET use_count = use_count + 1 WHERE id = $1 AND room_id = $2 AND revoked_at IS NULL AND
      (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR use_count < max_uses) RETURNING id`, once per
      new participant row (resume never consumes) (decision).
- [ ] Proof check: `timingSafeEqual(sha256(base64urlDecode(proof)), join_proof_hash)`; wrong → 403 `ROOM_KEY_INVALID`
      with nothing else about the room; unknown or deleted slug → 404 `ROOM_NOT_FOUND`.
- [ ] `POST /api/join/:slug/info` (`joinInfoSchema`) → `JoinInfo`: proof; a supplied invite must be valid (403
      `ROOM_INVITE_INVALID`); returns `signedIn`, `guestsAllowed` (global `guests.allowed` and `rooms.allow_guests`)
      so the UI can ask guests to sign in. Never consumes the invite.
- [ ] `POST /api/join/:slug` (`joinRequestSchema`) → `JoinResponse`: proof → everyone except host and co-hosts needs a
      valid invite (403 `ROOM_INVITE_REQUIRED` / `ROOM_INVITE_INVALID`; applies to signed-in users too) → guests allowed
      (403 `ROOM_GUESTS_NOT_ALLOWED`) → lock (403 `ROOM_LOCKED`; host and co-hosts bypass) → password (403
      `ROOM_PASSWORD_REQUIRED` / `ROOM_PASSWORD_INVALID`, backoff `room-password` per IP+room) → removed or denied in the
      current meeting (403 `JOIN_REMOVED` / `JOIN_DENIED`) → capacity over admitted+joined rows (409 `ROOM_FULL`) →
      waiting room (everyone except host and co-hosts) with at most 50 waiting per room (409 `LOBBY_FULL`) (decision).
      Guests must send `displayName` (400 `VALIDATION_FAILED` otherwise); signed-in users use their profile name.
      Guests get a `guest_sessions` row and the cookie `__Host-blinq_g_<slug>` (TTL 12 h (decision)).
- [ ] Resume: same user session or guest session + same `clientId` + the same live meeting + row `admitted|joined` →
      reuse the row and `lk_identity`, skip the lobby, new token. Rows from older meetings never skip the lobby.
- [ ] Meetings: the first admitted join creates the meeting (epoch = 16 random bytes, base64url; the unique partial
      index settles races, the loser reuses the winner) and calls `createRoom` (name = `rooms.id`,
      `maxParticipants` ≤ 25, `emptyTimeoutSec` 300, `departureTimeoutSec` 20 (decision), metadata from the
      `publishRoomState` builder); an existing live LiveKit room reuses its meeting.
- [ ] `server/services/livekit/room-service.ts`: `RoomServiceAdapter` over `RoomServiceClient` (`LIVEKIT_URL`,
      `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`); a fake adapter for API tests, selected in test builds only (mechanism
      agreed with `server-core` and documented in `docs/API.md`, Test-only section) (decision).
- [ ] `server/services/livekit/token.ts`: `buildParticipantToken(...)` — TTL 5 min, `roomJoin`, room = `rooms.id`,
      `canSubscribe`, `canPublishData`, `canUpdateOwnMetadata: false`, `canPublishSources` from role + room policy +
      `mic_allowed`/`camera_allowed` (`screen_share_audio` only with `screen_share`), attributes `role`, `kind`,
      `hand: ""`, `vol` from `volume_level`; never `hidden`, `roomAdmin`, `roomCreate`, `roomList`, `roomRecord`,
      `recorder` or an agent kind. `permissionSpec(...)` builds the full `ParticipantPermissionSpec` for updates.
- [ ] `server/services/livekit/publish-room-state.ts` implements `PublishRoomState`: rebuilds `RoomMetadata` from the
      DB, is the only caller of `updateRoomMetadata`, serializes calls per room, publishes `room.state` on the bus.
- [ ] Lobby: `GET /api/join/requests/:id/events` (SSE; only the user session or guest session that created the row,
      else 403 `FORBIDDEN`) and `POST /api/join/requests/:id/cancel` (204); events `status`, `admitted`, `denied`,
      `ended` (`WaitingEvent`), `: ping` every 15 s; driven by `lobby.decided` bus events; the token is minted when the
      request is admitted.
- [ ] Server hints: `{ type: 'lobby.changed' }` etc. on `blinq.srv.v1` via `sendData` with `destinationIdentities` =
      live hosts and co-hosts (or the single target for `ask-unmute`); never tokens, never destructive.
- [ ] `server/services/calls/authorize.ts`: `resolveCaller` + `canPerform(actor, action, target)` → 403 `CALL_FORBIDDEN`.
- [ ] In-call routes `server/api/calls/[roomId]/**` exactly as `docs/API.md` (me/name, me/hand, participants list,
      lobby list/admit/deny/admit-all, participant mute/permissions/ask-unmute/volume/remove/role/name/lower-hand,
      mute-all, settings, end). Order: DB update → LiveKit call → `publishRoomState` when room state changed. Remove
      marks the row `removed` (final for the meeting) and calls `removeParticipant` with `revokeTokensIssuedBefore`;
      a user promoted to co-host is persisted in `room_members`, a guest only on the live row.
- [ ] `POST /api/webhooks/livekit`: raw body, `WebhookReceiver.receive(body, authorization)` (401 on a bad signature),
      dedupe by event id (in-memory LRU, 10 min) (decision), unknown rooms ignored (agents share the dev LiveKit);
      `participant_joined` removes anyone whose row is not `admitted|joined` and marks admitted rows `joined`;
      `participant_left` → `left`; `room_finished` ends the meeting, sends `ended` to waiters, archives ephemeral rooms,
      publishes `recording.changed` when a recording was active; peak count maintained.
- [ ] `user.revoked` bus handling (requested contract, see Stage 02): `removeParticipant` for the user's live identities.
- [ ] `server/tasks/rooms/**` (if needed beyond `maintenance:cleanup`): close waiting rows older than 1 h.
- [ ] Limiters: `join-ip` (info and join), `room-create` (rooms and invites), `call-actions` (in-call routes).
### Frontend (rooms-ui, Wave 2)
- [ ] `app/pages/dashboard.vue` (`auth` middleware): rooms list, "New room", "Instant meeting", per room: copy host link,
      settings, join.
- [ ] Create flow: `generateSlug()`, `generateRoomKey()`, `deriveJoinProof(K, slug)` → `POST /api/rooms` (retry once
      with a new slug on 409 `CONFLICT`) → store K in the key vault → open `/m/<slug>` with K in the tab's
      sessionStorage (no fragment for in-app navigation) (decision). Instant meeting = the same with `ephemeral: true`.
- [ ] Key vault `app/lib/e2ee/key-vault.ts`: localStorage `blinq:keys:<userId>` → `{ [roomId]: { k, slug, keyVersion,
      savedAt } }` for rooms the user owns or co-hosts; sessionStorage `blinq:tabkey:<slug>` for the current tab
      (guests too); entries of another user id are ignored; `auth` clears `blinq:keys:*` on logout; every storage access
      is wrapped in try/catch.
- [ ] `app/pages/rooms/[id].vue`: settings (`roomSettingsSchema` fields, password set/clear), co-host list with remove,
      "Rotate key" (disabled while live; new K + proof via `PUT /api/rooms/:id/key`; old links then fail with
      `ROOM_KEY_INVALID`), meetings history, delete (in-page confirmation).
- [ ] Invite manager `app/components/rooms/InviteManager.vue`: create (label, `1h|24h|7d|never`, max uses), list,
      revoke; link = `buildRoomLink(publicUrl, slug, K, token)`; share by copy, `navigator.share` when available and
      `mailto:` (address shown as text too). The server never emails room links. Without K in the vault the UI says
      links cannot be built on this device.
- [ ] `/m/[slug]` flow (`app/lib/join/machine.ts` pure reducer + `app/composables/rooms/useJoinFlow.ts`) using the
      `CallPhase` names: `loading` (K and t from `$fragment.take('/m/<slug>')`, the tab key or the vault; `clientId`
      from sessionStorage `blinq:clientId`, created once per tab) → `needKey` | `info` (`POST /api/join/:slug/info`) →
      `prejoin` (`call-core` pre-join; REC notice when `recordingActive`) → `password` (when `needsPassword`) → join
      (`POST /api/join/:slug`) → `waiting` (EventSource; cancel; `denied` and `ended` are final) → `connecting`
      (`call-core` connect with `url`, `token`, `epoch`, `identity`, `slug`, K) → `inCall` → `left` | `ended` |
      `removed` | `error`.
- [ ] `app/components/join/JoinError.vue`: a clear message and next step for every join code (`ROOM_KEY_INVALID`,
      `ROOM_NOT_FOUND`, `ROOM_INVITE_REQUIRED`, `ROOM_INVITE_INVALID`, `ROOM_GUESTS_NOT_ALLOWED`, `ROOM_LOCKED`,
      `ROOM_FULL`, `ROOM_PASSWORD_INVALID`, `JOIN_REMOVED`, `JOIN_DENIED`, `LOBBY_FULL`, `RATE_LIMITED`), a key missing
      or truncated in the link (`parseRoomFragment().invalidKey`), and an unsupported browser.
- [ ] Duplicate tabs: `BroadcastChannel('blinq:call:<slug>')`; a tab in the call answers `hello`; the new tab offers
      "Use here", which asks the other tab to leave (decision).

## Tests
- Unit: `server/services/livekit/token.test.ts` (grants per role and policy; forbidden grants never set; TTL),
  `server/services/calls/authorize.test.ts`, `server/services/invites/token.test.ts` (round trip, tamper),
  `server/services/join/resume.test.ts`, `app/lib/join/machine.test.ts` (every transition and error),
  `app/lib/e2ee/key-vault.test.ts` (namespacing, other-user entries ignored, storage throwing).
- API: `tests/api/rooms/crud.test.ts` (owner-only, 404 for others, room limit, duplicate slug),
  `tests/api/rooms/key.test.ts` (rotation blocked while live, old proof rejected after rotation),
  `tests/api/join/proof.test.ts`, `tests/api/join/invites.test.ts` (bad, expired, revoked, overused under concurrency,
  guest without invite), `tests/api/join/limits.test.ts` (locked, full, guests off globally and per room, password
  backoff, removed and denied), `tests/api/join/lobby-sse.test.ts` (non-owner SSE and cancel → 403; event order;
  heartbeat), `tests/api/join/lobby-latency.test.ts` (admit → `admitted` on the owner's SSE < 1 s),
  `tests/api/join/resume.test.ts`, `tests/api/join/meeting.test.ts` (concurrent first joins → one meeting, one
  `createRoom`), `tests/api/calls/authz.test.ts` (every in-call route × role × target), `tests/api/calls/actions.test.ts`
  (each action → expected adapter call and DB change), `tests/api/webhooks/signature.test.ts` (401, dedupe, unknown room),
  `tests/api/webhooks/enforcement.test.ts`, `tests/api/rooms/room-state.test.ts` (metadata equals the DB state).
- E2E: `tests/e2e/rooms/create-and-join.spec.ts`, `tests/e2e/join/guest-invite.spec.ts` (click → first remote frame
  measured), `tests/e2e/join/lobby.spec.ts`, `tests/e2e/join/errors.spec.ts` (wrong key, revoked invite, locked),
  `tests/e2e/join/duplicate-tab.spec.ts`, `tests/e2e/rooms/key-leak.spec.ts` (records every request URL and body,
  WebSocket frame and SSE URL; then greps a `pg_dump` of the test DB and the app and Caddy logs for K).

## Definition of Done
- [ ] [auto] A guest joins via invite within the join-time budget (PR gate < 6 s; nightly p95 < 3 s) — evidence:
      `pnpm test:e2e -- join/guest-invite`, nightly.yml.
- [ ] [auto] Bad, expired, revoked and overused invites are rejected — evidence: `tests/api/join/invites.test.ts`.
- [ ] [auto] A wrong key is rejected by the proof — evidence: `tests/api/join/proof.test.ts`.
- [ ] [auto] SSE and cancel reject non-owners — evidence: `tests/api/join/lobby-sse.test.ts`.
- [ ] [auto] The key never leaves the browser — evidence: `pnpm test:e2e -- rooms/key-leak` (request URLs and bodies,
      WebSocket frames, SSE URLs, DB dump, app and Caddy logs).
- [ ] [auto] Lobby admit reaches the SSE in under 1 s (API level) — evidence: `tests/api/join/lobby-latency.test.ts`.
- [ ] [auto] A locked room rejects joins; capacity is enforced — evidence: `tests/api/join/limits.test.ts`.
- [ ] [auto] Token grants are unit-tested per role — evidence: `server/services/livekit/token.test.ts`.
- [ ] [auto] A removed participant cannot rejoin (webhook enforcement tested) — evidence:
      `tests/api/webhooks/enforcement.test.ts`, `tests/api/join/limits.test.ts`.
- [ ] [auto] Webhooks reject bad signatures and are deduplicated — evidence: `tests/api/webhooks/signature.test.ts`.
- [ ] [auto] One meeting per room under concurrent first joins — evidence: `tests/api/join/meeting.test.ts`.
- [ ] [auto] Every in-call route enforces the permission matrix — evidence: `tests/api/calls/authz.test.ts`.
- [ ] [auto] Room metadata is written only through `publishRoomState` and matches the DB — evidence:
      `tests/api/rooms/room-state.test.ts`.
- [ ] [auto] Join error screens and duplicate-tab detection work — evidence: `pnpm test:e2e -- join`.
- [ ] [auto] No console errors or CSP violations on dashboard, room settings and `/m/[slug]` — evidence:
      `pnpm test:e2e -- rooms join` (base fixture).
- [ ] [auto] `lint`, `typecheck`, `test`, `test:api` are green — evidence: ci.yml.
- [ ] [agent-manual] `/m/<slug>` is not server-rendered — evidence: `curl -s <base>/m/abc-defg-hjk` shows the SPA shell
      without room data, pasted into the report.

## Notes and gotchas
- `room.auto_create: false`: always `createRoom` before the first token of a meeting.
- Participant permissions replace the whole object; always send a full `ParticipantPermissionSpec`.
- `participant_joined` enforcement is the backstop for leaked tokens; never skip it for "known" identities.
- LiveKit refreshes tokens while connected; reconnects after the 5-minute TTL go through `POST /api/join/:slug` again
  (resume rules apply).
- Dev LiveKit posts webhooks to ports 3000–3005; ignore rooms missing from your own DB.
- Server hints arrive unencrypted (the server has no key); clients treat them only as "refetch".
- Invites are independent of K; after a rotation the owner re-copies links and old ones fail with `ROOM_KEY_INVALID`.
  The "rotate the key before the next meeting" prompt after a removal is client-side (`collab-ui`) (decision).
- Never put secrets in query strings; `EventSource` URLs carry only the request id.
