# Stage 03 — Admin panel

Status: done
Owner(s): `admin` (Wave 2)
Depends on: Stage 02 (`auth`: users service, mail), Stage 04 backend (`rooms-backend`: LiveKit adapter, room end and
delete, meetings)
Blocks: Stage 10 (full-flow E2E and release)

## Goal
Admins manage users (create with a temporary password, invite, disable, change role, reset password, revoke sessions,
delete), change settings that apply immediately without a restart, see every room and meeting (metadata only, with
live participant counts from LiveKit), end or delete rooms, read the audit log, and check SMTP. Every admin route
rejects non-admins, the last admin cannot be removed, and every mutation is audited.

## Scope
### In scope
- `/api/admin/users/**`, `/api/admin/invites/**`, `/api/admin/settings/**`, `/api/admin/rooms/**`, `/api/admin/audit`
  (`docs/API.md` Admin section).
- Pages `app/pages/admin/{index,users,invites,settings,rooms,audit}.vue`.
- Last-admin protection, SMTP status and test email.
### Out of scope (and where it lives instead)
- `GET /api/admin/recordings`, `DELETE /api/admin/recordings/:id` and `app/pages/admin/recordings.vue`: Stage 08
  (`recording-server`).
- Accepting invites, user-facing resets: Stage 02 (`auth`).
- LiveKit adapter, `publishRoomState`, room deletion plumbing: Stage 04 (`rooms-backend`), consumed here.

## Owned paths
- `server/api/admin/**` except `server/api/admin/recordings/**`
- `server/services/admin/**`
- `app/pages/admin/**` except `app/pages/admin/recordings.vue`
- `app/components/admin/**`
- `tests/api/admin/**`, `tests/e2e/admin/**`
### Consumes (must not edit)
- `shared/schemas/{admin,settings,rooms,common}.ts`, `shared/utils/error-codes/index.ts`
- `server/utils/**` (`requireAdmin`, `apiError`), `server/services/{session,settings,audit}/**` (`server-core`)
- `server/services/{users,mail}/**`, `server/mail/**` (`auth`)
- `server/services/{rooms,meetings,livekit}/**` (`rooms-backend`), `server/services/recordings/**`
  (`recording-server`, for deleting a user's recording files)
- `app/layouts/admin.vue`, `app/components/{ui,app}/**`, `app/composables/useApi.ts`

## Tasks
### Already built in Wave 1 (consume, don't duplicate)
- `server/services/users/admin.ts` (`auth`): `listUsers`, `getAdminUser`, `createUserByAdmin`, `updateUserByAdmin`
  (disable revokes sessions, a role change rotates them, self and last-admin rules), `resetPasswordByAdmin`,
  `revokeUserSessions`, `deleteUser(id, actor, { beforeDelete })`; `server/services/users/last-admin.ts` (row locks,
  `assertKeepsAnAdmin`); `server/services/users/invites.ts` (`createAccountInvite`, `listAccountInvites`,
  `revokeAccountInvite`). These services **write their own audit entries** (`admin.user_*`, `admin.invite_*`); the
  handlers must not add a second one.
- `server/services/settings` `updateSettings(rawPatch, actorUserId)` (re-validates, invalidates the cache; the handler
  writes `admin.settings_updated` with old and new values); `server/services/mail` `isSmtpConfigured()`, `testMessage`,
  `sendMailOr503`; `server/services/meetings` `endMeeting(roomId, { reason: 'admin' })`, `endMeetingsOfOwner`,
  `listMeetings`; `server/services/rooms` `softDeleteRoom`; `roomService().listRooms()`;
  `server/services/recordings/api.ts` `deleteRecordingsForUser`.
- Missing and owned by `admin`: an admin-wide rooms query with live counts, the audit-log query, the SMTP status and
  test email, and the delete-user orchestration (`beforeDelete`: end the user's live meetings, delete recording files).
  `POST /api/admin/users/:id/revoke-sessions` answers 204 even though the service returns `{ revoked }`.

### Backend
- [x] Every handler starts with `requireAdmin(event)`; list endpoints parse `paginationQuerySchema` extensions and
      return `Paginated<T>`.
- [x] `GET /api/admin/users` (`adminUsersQuerySchema`: `q`, `role`, `status`) → `Paginated<AdminUser>`;
      `GET /api/admin/users/:id` → `{ user: AdminUser }`.
- [x] `POST /api/admin/users` (`adminCreateUserSchema`): generated 16-character temporary password,
      `must_change_password = true`; returned once in the response, or emailed when `sendEmail` (requires SMTP, else
      503 `SERVICE_UNAVAILABLE`); existing email → 409 `CONFLICT`; audit `admin.user_created`.
- [x] `PATCH /api/admin/users/:id` (`adminUpdateUserSchema`): disabling revokes sessions and publishes `user.revoked`
      (rooms-backend removes live call identities); a role change rotates the user's sessions; audit
      `admin.user_updated` with the changed field names.
- [x] `DELETE /api/admin/users/:id`: ends live meetings of the user's rooms (`DeleteRoom`), deletes the user's
      recording files through the recording service, then deletes the row (rooms and recordings cascade); an admin
      cannot delete their own account (409 `CONFLICT`, `details.reason = 'self'`) (decision); audit
      `admin.user_deleted` (email kept in `details`).
- [x] Last-admin protection (already in `server/services/users/last-admin.ts`, used by the users service): demoting,
      disabling or deleting the only enabled admin → 409 `CONFLICT` with `details.reason = 'last_admin'`, checked in the
      same transaction with `SELECT … FOR UPDATE`. Verify it through the admin API.
- [x] `POST /api/admin/users/:id/reset-password` (`{ sendEmail?: boolean }`, schema to be added to
      `shared/schemas/admin.ts` (decision)): new temporary password returned once (or a reset link emailed), sets
      `must_change_password`, revokes sessions; audit `admin.user_password_reset`.
- [x] `POST /api/admin/users/:id/revoke-sessions`: audit `admin.user_sessions_revoked`.
- [x] `GET /api/admin/invites` → `Paginated<AdminInvite>`; `POST /api/admin/invites` (`adminCreateInviteSchema`:
      admin-role invites need an email and expire within 24 h) → `CreatedInvite` (token shown once; link
      `${publicUrl}/invite#${token}`; stored as sha256 only; `sendEmail` requires SMTP); `DELETE /api/admin/invites/:id`
      revokes; audit `admin.invite_created`, `admin.invite_revoked`.
- [x] `GET /api/admin/settings` → `{ settings: Settings, smtp: { configured, host, from } }`; `PUT /api/admin/settings`
      (`settingsUpdateSchema`, partial and strict; the merged result is re-validated; `registration.mode = 'domain'`
      without SMTP → 400 `VALIDATION_FAILED` with `details.field`) writes through the settings service so the next
      request sees it; audit `admin.settings_updated` with old and new values.
- [x] `POST /api/admin/settings/test-email` (`{ to?: string }`, default the admin's email): 503 when SMTP is off; SMTP
      failures → 503 with `details.smtpError` (message only, never credentials); audit `admin.test_email_sent`.
- [x] `GET /api/admin/rooms` → `Paginated<AdminRoom>` with `live` and `participantCount` from LiveKit `listRooms`
      (LiveKit unreachable → counts from the DB and `live` from the meeting row, never a 500).
- [x] `POST /api/admin/rooms/:id/end` (via the rooms-backend meeting service: `DeleteRoom`, meeting ended, waiting
      requests get `ended`) and `DELETE /api/admin/rooms/:id` (soft delete via rooms-backend, ends a live meeting);
      audit `admin.room_ended`, `admin.room_deleted`.
- [x] `GET /api/admin/rooms/:id/meetings` → `Paginated<MeetingSummary>` (start, end, peak; never chat, media or keys).
- [x] `GET /api/admin/audit` (`auditQuerySchema`: `q` over target, `action`, `actorUserId`) → `Paginated<AuditEntry>`.
### Frontend
- [x] `admin/index.vue`: counts (users, rooms, live meetings), SMTP status badge, links to sections.
- [x] `admin/users.vue`: table with search and filters; create dialog (shows the temporary password once with copy);
      detail sheet with role, disable, reset password, revoke sessions, delete (decision: detail in a sheet, no
      separate page); last-admin and self errors shown inline.
- [x] `admin/invites.vue`: create dialog (link shown once with copy), list, revoke.
- [x] `admin/settings.vue`: one form section per group (registration, guests, media, limits, recording, privacy and
      audit), SMTP status and "Send test email".
- [x] `admin/rooms.vue`: rooms with live counts, end and delete, expandable meeting history per room.
- [x] `admin/audit.vue`: filters and paging; details rendered as text (never `v-html`).
- [x] Destructive actions use an in-page confirmation dialog (no `confirm()`).

## Tests
- Unit: last-admin rules are covered by `tests/api/auth/last-admin.test.ts` (Wave 1); colocated unit tests for every new
  module in `server/services/admin/` (rooms list with the LiveKit fallback, audit query building).
- API: `tests/api/admin/authz.test.ts` (table-driven over every method + path under `server/api/admin/**`, the list
  generated from the file tree so new routes are covered automatically (decision): anonymous → 401
  `UNAUTHENTICATED`, user → 403 `FORBIDDEN`, guest cookie only → 401), `tests/api/admin/users.test.ts`,
  `tests/api/admin/last-admin.test.ts` (incl. two concurrent demotions), `tests/api/admin/invites.test.ts` (token once,
  admin invite needs email and 24 h), `tests/api/admin/settings-live.test.ts` (switch `registration.mode` to `open` →
  the next `POST /api/auth/register` succeeds; switch `guests.allowed` off → the next guest join gets
  `ROOM_GUESTS_NOT_ALLOWED`; no restart), `tests/api/admin/test-email.test.ts` (Mailpit receives it; 503 without SMTP),
  `tests/api/admin/rooms.test.ts` (live counts via the fake RoomService; end and delete call `deleteRoom`; strict
  response schema has no keys, proofs or tokens), `tests/api/admin/audit.test.ts` (table-driven: each mutating admin
  route adds exactly one audit row with the documented action).
- E2E: `tests/e2e/admin/users.spec.ts` (`@ui`: create a user → that user is forced to change the password),
  `tests/e2e/admin/settings.spec.ts` (`@ui`: change a setting, reload, it persists), `tests/e2e/admin/responsive.spec.ts`
  (`@responsive`: no horizontal overflow at 375/768/1440).

## Definition of Done
- [x] [auto] Every admin route answers 403 for non-admins and 401 for anonymous callers — evidence:
      `tests/api/admin/authz.test.ts` (route list from the file tree; also 401 with only a guest cookie).
- [x] [auto] A setting takes effect immediately, without a restart — evidence: `tests/api/admin/settings-live.test.ts`.
- [x] [auto] The last admin is protected (demote, disable, delete) — evidence: `tests/api/admin/last-admin.test.ts`
      (private server and database; concurrent self-demotions: exactly one wins).
- [x] [auto] Every admin mutation is audited — evidence: `tests/api/admin/audit.test.ts`.
- [x] [auto] The SMTP test email arrives; without SMTP the endpoint answers 503 — evidence:
      `tests/api/admin/test-email.test.ts`.
- [x] [auto] Ending or deleting a room calls `deleteRoom` and ends the meeting — evidence: `tests/api/admin/rooms.test.ts`.
- [x] [auto] Admin responses never contain room keys, proofs, invite tokens of rooms, chat or media — evidence:
      `tests/api/admin/rooms.test.ts`.
- [x] [auto] Admin pages have no console errors, CSP violations or horizontal overflow — evidence:
      `sh scripts/e2e.sh --project=chromium --project=webkit-ui --project=mobile-chromium tests/e2e/admin` (14 passed;
      tables are checked for sideways scrolling too).
- [x] [auto] `lint`, `typecheck`, `test`, `test:api` are green — evidence: ci.yml; locally lint, typecheck, build,
      895 unit tests and `test:api tests/api/admin tests/api/core tests/api/auth` (325 passed).
- [x] [agent-manual] Disabling a user removes them from a live call within 1 s — evidence: automated already in
      `tests/e2e/admin/disable-live.spec.ts` (dev LiveKit: the user's call reaches `removed` < 1 s after the admin
      confirms in the UI; the server removed the identity 10 ms after the PATCH answered).

## Notes and gotchas
- Lock admin rows in the same transaction for the last-admin check; two concurrent demotions must not both succeed.
- Live counts come from LiveKit and can fail; the rooms list must still render from the DB.
- Admins see metadata only. Recordings are the one exception (full access, every playback audited) and belong to
  `recording-server`.
- Always write settings through the settings service so its cache is invalidated.
- Account invite links carry the token in the fragment (`/invite#<token>`) and are shown once.
- `DELETE /api/admin/users/:id` cascades rooms and recordings in the DB; recording files must be deleted first or they
  become orphans.
