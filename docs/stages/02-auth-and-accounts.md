# Stage 02 — Auth and accounts

Status: todo
Owner(s): `auth` (Wave 1)
Depends on: Stage 01 (W0a contracts; `server-core` sessions, guards, CSRF, limiters, argon2, settings, audit;
`ui-shell` layouts and fragment capture)
Blocks: Stage 03 (`admin`), Stage 04 frontend (`rooms-ui`), Stage 10 E2E flows

## Goal
People can sign in and out, register (per registration mode), accept account invites, verify their email, reset and
change their password, and manage their profile and sessions. The first admin created by bootstrap is forced through a
password change before anything else works. Every rule is covered by API tests, and no flow reveals whether an email is
registered (except the documented open-mode limitation).

## Scope
### In scope
- `/api/auth/**` and `PATCH /api/me` (`docs/API.md` Auth and Me sections, plan section 2.5).
- Registration modes, account-invite acceptance, email verification, password reset, password change, login backoff,
  `AuthProvider` interface with an OIDC stub test, session list/revoke, audit entries, mail transport and templates.
- Pages `/login`, `/register`, `/invite`, `/verify-email`, `/forgot-password`, `/reset-password`, `/change-password`,
  `/settings` (profile, password) and `/settings/sessions`; client route middleware.
### Out of scope (and where it lives instead)
- Session primitives, cookies, CSRF, limiter, argon2, the forced-password-change guard middleware, and the
  `maintenance:cleanup` task: Stage 01 (`server-core`), consumed and tested here.
- Creating account invites, creating users, admin resets, disabling users, SMTP test email: Stage 03 (`admin`).
- Guest sessions for calls: Stage 04 (`rooms-backend`). Removing a revoked user from live calls: Stage 04.
- Real OIDC providers: backlog.

## Owned paths
- `server/api/auth/**`, `server/api/me.patch.ts`
- `server/services/{auth,users,mail}/**`, `server/mail/**`
- `app/pages/{login,register,invite,verify-email,forgot-password,reset-password,change-password}.vue`,
  `app/pages/settings/**`
- `app/components/auth/**`, `app/composables/useAuth.ts`, `app/middleware/**`
- `tests/api/auth/**`, `tests/e2e/auth/**`
### Consumes (must not edit)
- `shared/schemas/{common,auth,settings}.ts`, `shared/utils/error-codes/index.ts`, `shared/utils/display-name.ts`
- `server/utils/**` (incl. `env.ts`, `api-error.ts`), `server/middleware/**`, `server/services/{session,settings,audit}/**`,
  `server/contracts/index.ts`, `server/database/**`
- `app/composables/useApi.ts`, `app/lib/e2ee/fragment.ts`, `app/plugins/00.fragment.client.ts` (`$fragment`),
  `app/layouts/**`, `app/components/{ui,app}/**`

## Tasks
### Backend
- [ ] `server/services/auth/password-policy.ts`: `passwordSchema` length rules (12..256) plus the bundled
      common-password denylist (`server/services/auth/common-passwords.txt`, top 10k, compared lowercased) → 400
      `AUTH_PASSWORD_WEAK` with `details.reason` `common`.
- [ ] `server/services/auth/providers/{types,password,index}.ts`: `AuthProvider { id: 'password' | \`oidc:${string}\`;
      authenticate(input): Promise<{ userId: string } | null> }`, a registry, and identities in `auth_identities`;
      `sessions.auth_method` = provider id.
- [ ] `POST /api/auth/login`: normalize email; check the `login` backoff for `email:<address>` and `ip:<address>` /
      `net:<ipv6 /64>` first (429 `RATE_LIMITED` + `Retry-After`); unknown email → dummy verify; wrong password →
      record failure, 401 `AUTH_INVALID_CREDENTIALS`; after a correct password: disabled → 403
      `AUTH_ACCOUNT_DISABLED`; unverified account while `registration.mode = 'domain'` → 403 `AUTH_EMAIL_NOT_VERIFIED`
      and one new verification mail per 10 min (decision); success → reset the email throttle, create and rotate the
      session, set the cookie, update `last_login_at`, audit `auth.login`.
- [ ] Backoff curve (`server/services/auth/throttle.ts` over `login_throttle`): 5 free failures, then `2^(n-5)` s,
      capped at 900 s; never a hard lockout (decision on numbers).
- [ ] `POST /api/auth/logout` (204, cookie cleared, audit `auth.logout`); `GET /api/auth/me` → `MeResponse`
      (`{ user: null }` with 200 when anonymous).
- [ ] `POST /api/auth/password` (`changePasswordSchema`): verify `currentPassword`, apply the policy, clear
      `must_change_password`, revoke all other sessions, rotate the current one, publish a `user.revoked` bus event
      so `rooms-backend` removes the user's live call identities, audit `auth.password_changed`. `BusEvent` in
      `server/contracts/index.ts` has no `user.revoked` variant yet: request
      `{ type: 'user.revoked'; userId: string; reason: 'password_changed' | 'password_reset' | 'disabled' | 'deleted' }`
      from the orchestrator (decision).
- [ ] `POST /api/auth/register` (mode read live from the settings service): `invite_only` → 403 `REGISTRATION_CLOSED`;
      `open` → create, sign in, 201 `{ user }`; `domain` → domain must be in `registration.allowedDomains` (403
      `REGISTRATION_DOMAIN_NOT_ALLOWED`), SMTP must be configured (503 `SERVICE_UNAVAILABLE`), create unverified, send
      the verification mail, 202 `{ verificationRequired: true }`; an existing email in `domain` mode gets the same 202
      and an "account exists" mail (no enumeration).
- [ ] `POST /api/auth/verify-email` (`tokenBodySchema`): `email_tokens` purpose `verify_email`, TTL 24 h (decision),
      single use; sets `email_verified_at`; audit `auth.email_verified`.
- [ ] `POST /api/auth/password-reset/request`: SMTP off → 503 `SERVICE_UNAVAILABLE`; otherwise always 202
      `{ ok: true }`; an existing, enabled account gets a reset mail (TTL 1 h (decision)); limiters `auth-ip` and
      `reset-email` (silent).
- [ ] `POST /api/auth/password-reset/confirm`: single-use token, policy, new hash, `must_change_password = false`,
      revoke all sessions, publish `user.revoked`, audit `auth.password_reset`; does not sign in (decision).
- [ ] `POST /api/auth/invites/preview` → `InvitePreview`; `INVITE_INVALID` (unknown or revoked), `INVITE_EXPIRED`,
      `INVITE_USED`.
- [ ] `POST /api/auth/invites/accept` (`acceptInviteSchema`): atomic `UPDATE user_invites SET used_at = now(),
      used_by = $user WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      RETURNING *` in the user-creation transaction; a bound invite (always the case for `role = 'admin'`) takes its
      email and rejects a different one with 400 `INVITE_INVALID`; an unbound invite requires `email`; invites work in
      every registration mode and bypass the domain list; a bound email counts as verified (decision); existing email →
      409 `CONFLICT`; signs in, 201; audit `auth.invite_accepted`.
- [ ] `GET /api/auth/sessions` → `{ items: SessionInfo[] }`; `DELETE /api/auth/sessions/:id` (own sessions only, else
      404 `NOT_FOUND`; revoking the current session clears the cookie); audit `auth.session_revoked`.
- [ ] `PATCH /api/me` (`updateMeSchema`) → `{ user: AuthUser }`; audit `user.profile_updated`.
- [ ] `server/services/users/**`: `createUser`, `findUserByEmail`, `setPassword`, `setDisabled`, `setRole` (rotates
      sessions on privilege change), `deleteUser` — consumed by `admin`.
- [ ] `server/services/mail/transport.ts` (nodemailer from `SMTP_*`, `isSmtpConfigured()`, send timeout) and
      `server/mail/templates/{verify-email,reset-password,account-exists,account-invite,temp-password,test-email}.ts`
      (plain text + minimal inline HTML, no remote images; links from `PUBLIC_URL` with the token in the fragment).
      The server never sends room links.
### Frontend
- [ ] `app/composables/useAuth.ts`: `user` (`useState`), `refresh()`, `login()`, `logout()`. `logout()` and a detected
      session loss clear every localStorage key starting with `blinq:keys:` (key-vault contract with `rooms-ui`)
      (decision).
- [ ] `app/middleware/auth.ts` (anonymous → `/login?next=<route.path>`; `mustChangePassword` → `/change-password`) and
      `app/middleware/guest-only.ts` (signed-in users leave auth pages → `/dashboard`); `next` accepted only as a relative
      path starting with a single `/`.
- [ ] Pages (layout `auth`; TanStack Form + shadcn `Field` + the shared zod schemas; field errors and code messages via
      `ApiError`): `/login` (hides "Forgot password" and says "ask an administrator" when `smtpEnabled` is false),
      `/register` (only when mode is not `invite_only`), `/invite` (token via `$fragment.take('/invite')`, preview then
      accept; bound email shown read-only), `/verify-email`, `/forgot-password`, `/reset-password`, `/change-password`
      (forced mode hides navigation).
- [ ] `/settings` (profile name, password change) and `/settings/sessions` (list with a "this device" marker, revoke).
### Tests
- [ ] API and E2E tests below. New dependencies or contract changes go into the report.

## Tests
- Unit: `server/services/auth/password-policy.test.ts` (bounds, denylist), `server/services/auth/throttle.test.ts`
  (curve, cap, reset on success, `net:` keys for IPv6), `server/services/auth/providers/registry.test.ts`.
- API: `tests/api/auth/login.test.ts` (success sets the cookie; wrong password and unknown email give identical status and
  body; backoff ⇒ 429 with `Retry-After`; disabled; unverified in domain mode), `tests/api/auth/cookie.test.ts`
  (`HttpOnly`, `Secure` in the prod-mode build, `SameSite=Lax`, `Path=/`, `__Host-` prefix),
  `tests/api/auth/guard.test.ts` (bootstrap admin gets 403 `AUTH_PASSWORD_CHANGE_REQUIRED` on a sample of routes;
  the allowlist works), `tests/api/auth/register.test.ts` (three modes, live mode switch, domain list, domain mode needs
  SMTP and verification, no enumeration), `tests/api/auth/invites.test.ts` (single use under concurrent accepts, expiry,
  revoked, admin invite bound to its email), `tests/api/auth/password-reset.test.ts` (Mailpit link, single use, expiry,
  sessions revoked, 503 without SMTP, no enumeration), `tests/api/auth/verify-email.test.ts`,
  `tests/api/auth/sessions.test.ts` (list, revoke own only, absolute and idle expiry by aging rows in the test DB, a
  revoked session is rejected on the next request), `tests/api/auth/password-change.test.ts` (other sessions revoked),
  `tests/api/auth/csrf.test.ts` (cross-origin login rejected), `tests/api/auth/oidc-stub.test.ts` (a stub provider
  signs in a user without a password through `auth_identities`; runs in-process against the test DB (decision)),
  `tests/api/auth/logs.test.ts` (no token or password in captured server logs).
- E2E: `tests/e2e/auth/first-admin.spec.ts` (bootstrap admin → forced change → dashboard),
  `tests/e2e/auth/invite-accept.spec.ts`, `tests/e2e/auth/password-reset.spec.ts` (Mailpit),
  `tests/e2e/auth/settings.spec.ts` (rename, revoke another session) — all tagged `@ui`.

## Definition of Done
- [ ] [auto] Backoff ⇒ 429 with `Retry-After`, never a hard lockout — evidence: `tests/api/auth/login.test.ts`.
- [ ] [auto] The guard answers 403 `AUTH_PASSWORD_CHANGE_REQUIRED` — evidence: `tests/api/auth/guard.test.ts`.
- [ ] [auto] Account invites are single-use (also under concurrency) and expire — evidence:
      `tests/api/auth/invites.test.ts`.
- [ ] [auto] Admin invites are bound to an email — evidence: `tests/api/auth/invites.test.ts`.
- [ ] [auto] Domain mode needs SMTP and verification — evidence: `tests/api/auth/register.test.ts`.
- [ ] [auto] No enumeration on login, reset and domain-mode registration — evidence: `tests/api/auth/login.test.ts`,
      `tests/api/auth/password-reset.test.ts`, `tests/api/auth/register.test.ts`.
- [ ] [auto] Cookie flags are correct — evidence: `tests/api/auth/cookie.test.ts`.
- [ ] [auto] CSRF rejects a cross-origin request — evidence: `tests/api/auth/csrf.test.ts`.
- [ ] [auto] OIDC stub test passes — evidence: `tests/api/auth/oidc-stub.test.ts`.
- [ ] [auto] Password policy (≥ 12 chars, denylist) holds — evidence: `server/services/auth/password-policy.test.ts`.
- [ ] [auto] Absolute (30 d) and idle (7 d) expiry; revoked sessions rejected — evidence: `tests/api/auth/sessions.test.ts`.
- [ ] [auto] Password change and reset revoke other sessions — evidence: `tests/api/auth/password-change.test.ts`,
      `tests/api/auth/password-reset.test.ts`.
- [ ] [auto] Tokens and passwords never appear in logs — evidence: `tests/api/auth/logs.test.ts`.
- [ ] [auto] E2E: first admin login → forced change → dashboard — evidence: `pnpm test:e2e -- auth/first-admin`.
- [ ] [auto] Auth pages show no console errors or CSP violations — evidence: `pnpm test:e2e -- auth` (base fixture).
- [ ] [auto] `lint`, `typecheck`, `test`, `test:api` are green — evidence: ci.yml.
- [ ] [agent-manual] Every mutation writes an audit entry with the documented action — evidence: `psql -c "select action,
      count(*) from audit_log group by 1"` after the API suite, pasted into the report.

## Notes and gotchas
- Unknown emails must pay the argon2 cost, and the dummy verify must go through the same semaphore, or timing leaks.
- Tokens arrive in the URL fragment and are POSTed in the body; never accept them in a query string and never log
  `/api/auth/**` bodies.
- In `open` mode registration cannot hide whether an email exists; `docs/SECURITY.md` documents this (decision). Login
  and reset never enumerate.
- Read `registration.mode` from the settings service on every request; caching it in module state breaks Stage 03's
  "setting takes effect immediately".
- Pass `schema.parse` (not `safeParse`) to `readValidatedBody`.
- `README.md` tells operators to remove `ADMIN_PASSWORD` after the first login (owned by `infra`).
