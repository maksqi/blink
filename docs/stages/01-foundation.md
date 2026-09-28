# Stage 01 — Foundation

Status: todo
Owner(s): `orchestrator` (W0a); `server-core`, `ui-shell`, `devops-ci` (W0b, parallel worktrees)
Depends on: Stage 00
Blocks: every Wave 1 workstream (`auth`, `rooms-backend`, `call-core`, `recording-server`, `infra`)

## Goal
A running, empty-but-complete skeleton: every dependency, every shadcn-vue component, the full `nuxt.config.ts`, the
complete Drizzle schema with its first migration, all shared contracts and interfaces, and a 501 stub for every API
route and page. W0b adds the server core (sessions, guards, CSRF, limiters, logging, health, CLI, settings, audit),
the UI shell (layouts, theme, navigation, fragment capture) and CI. Afterwards Wave 1 agents only fill in stubs inside
their owned paths and never touch frozen files.

## Scope
### In scope
- Pre-flight files, scaffold, dependencies, tool configs, contracts, schema, interfaces, stubs, env parsing, dev
  compose, first versions of the dev scripts (W0a).
- Server core, UI shell, CI workflows and E2E plumbing (W0b).
### Out of scope (and where it lives instead)
- Auth flows, pages and mail: Stage 02 (`auth`). Rooms, join, LiveKit service, webhooks, in-call APIs: Stage 04
  (`rooms-backend`). Call UI and media: Stage 05 (`call-core`).
- `scripts/vendor-assets.mjs` and `public/vendor/**`: Stage 07 (`media-fx`).
- `Dockerfile`, prod compose, Caddy prod config, `scripts/{init-env.sh,preflight.sh,smoke-prod.sh}`: Stage 09a (`infra`).

## Owned paths
- `orchestrator` (W0a, frozen afterwards): `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version`,
  `.npmrc`, `nuxt.config.ts`, `app.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc*`,
  `vitest.config.ts`, `playwright.config.ts`, `drizzle.config.ts`, `components.json`, `.gitignore`, `.editorconfig`,
  `.dockerignore`, `.worktreeinclude`, `.claude/**`, `.env.example`, `.env.dev.example`, `server/utils/env.ts`,
  `server/utils/api-error.ts`, `server/database/**`, `server/contracts/**`, `shared/**`, `app/lib/contracts/**`,
  `app/lib/e2ee/**` (except `key-vault.ts`), `app/composables/useApi.ts`, `app/components/ui/**`, every 501 stub
  until its owner replaces it.
- `server-core` (W0b): `server/middleware/**`, `server/plugins/**`, `server/utils/**` (except `env.ts`,
  `api-error.ts`), `server/services/{session,settings,audit}/**`, `server/tasks/maintenance/**` (per the stub header;
  to be added to the ROADMAP map), `server/api/{health,ready,config}.get.ts`, `server/cli.ts`, `scripts/build-cli.mjs`,
  `tests/api/_harness/**`, `tests/api/core/**`.
- `ui-shell` (W0b): `app/app.vue`, `app/error.vue`, `app/assets/**`, `app/layouts/**`, `app/components/app/**`,
  `app/plugins/**`, `app/pages/index.vue`, `public/*` (not `public/vendor/**`), `tests/e2e/shell/**`.
- `devops-ci` (W0b): `.github/workflows/**`, `docker-compose.dev.yml` (refinements), `docker/e2e/**`,
  `docker/livekit/**`, `scripts/{check-english.mjs,worktree-setup.mjs,with-lock.sh,detect-ip.sh}`,
  `tests/e2e/fixtures/base.ts`, `docs/TESTING.md`.
- After the W0b merge, layouts, navigation, `.github/workflows/**` and `docker-compose.dev.yml` become frozen.
### Consumes (must not edit)
- `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `AGENT.md`. W0b agents consume every W0a file.

## Tasks
### W0a (orchestrator) — pre-flight and scaffold
- [ ] `.claude/settings.json` = `{"worktree":{"baseRef":"head"}}`; `.worktreeinclude` lists `.env`.
- [ ] `pnpm-workspace.yaml` created **before** scaffolding, with `minimumReleaseAge` and an explicit `allowBuilds`
      `true`/`false` for every package with an install script (`@node-rs/argon2`, `esbuild`, …).
- [ ] `.node-version` = `24`; `package.json` `engines.node` 24, `packageManager: pnpm@11.20.0`.
- [ ] `.gitignore` and `.dockerignore` (`.claude/worktrees/`, `.env`, `.output/`, `.nuxt/`, `node_modules/`,
      `test-results/`, `playwright-report/`, `public/vendor/`); `.claude/**` ignored by ESLint, Vitest, tsconfig and
      Nuxt (`ignore`, `watchers.chokidar.ignored`, `vite.server.watch.ignored`).
- [ ] Nuxt 4 minimal template scaffolded in a temp dir with install disabled, moved into the repo; no install before
      the repo's own `pnpm-workspace.yaml` exists; `pnpm root` asserted to print `<repo>/node_modules`.
- [ ] Every dependency installed upfront (plan section 1 pins; `@mediapipe/tasks-vision` exact `0.10.14`;
      `openid-client` deferred with OIDC to the backlog); `pnpm install` followed by `git diff --exit-code` is clean.
- [ ] Scripts in `package.json`: `dev`, `dev:deps`, `dev:deps:logs`, `build`, `build:test`, `preview`, `cli` (tsx),
      `db:generate`, `db:migrate`, `lint`, `typecheck`, `test`, `test:api`, `test:e2e`, `check:english`, `vendor`.
- [ ] shadcn-vue: `components.json`, `shadcn: { prefix: '', componentDir: '@/components/ui' }`, every component
      installed into `app/components/ui/**`.
### W0a — nuxt.config.ts (complete, frozen)
- [ ] Modules `@nuxtjs/color-mode`, `@pinia/nuxt`, `@vueuse/nuxt`, `nuxt-security`, `shadcn-nuxt`, `@nuxt/eslint`,
      `@nuxt/test-utils/module`; Tailwind via `@tailwindcss/vite`; CSS `app/assets/css/tailwind.css`.
- [ ] `colorMode`: `preference: 'system'`, `fallback: 'light'`, `classSuffix: ''`, `storageKey: 'blinq-color-mode'`.
- [ ] `routeRules`: `/m/**` `ssr: false`; `/dev/**` `ssr: false` only in dev/test builds; `/api/recordings/**`
      request size limit 20 MB (the chunk handler enforces `RECORDING_CHUNK_MAX_BYTES` = 16 MiB).
- [ ] `security`: nonce CSP exactly per plan section 2.10 (dev adds `ws://localhost:7880`, `http://localhost:7880`),
      `script-src-attr 'none'`; Permissions-Policy overridden (camera, microphone, display-capture, fullscreen,
      speaker-selection, picture-in-picture, autoplay = self); COOP/CORP same-origin, COEP off, `no-referrer`, HSTS
      off (Caddy); `rateLimiter: false`, `xssValidator: false`, `corsHandler: false`, `requestSizeLimiter` 1 MB.
- [ ] `nitro`: `experimental.tasks`; `scheduledTasks` `recordings:finalize-stale` (every 2 min),
      `maintenance:cleanup` (hourly), `recordings:retention` + `maintenance:retention` (daily); stub task files in
      `server/tasks/{maintenance,recordings}/`.
- [ ] Build flag `__BLINQ_TEST_HOOKS__` (`vite.define` + `nitro.replace`, declared in `shared/types/build-flags.d.ts`);
      `pages:extend` registers `/dev/call` → `app/dev/CallHarness.vue` only in dev and test builds.
### W0a — database and contracts
- [ ] `drizzle.config.ts`; `server/database/schema/{_columns,users,system,rooms,recordings,index}.ts` (all tables of
      plan section 2.3; `rooms.join_proof_hash` required, `rooms.key_version`; `room_members.role` only `cohost`;
      unique partial index for one live meeting per room); `server/database/migrations/0000_init.sql`;
      `server/database/{client,migrate}.ts`.
- [ ] `shared/schemas/{common,auth,rooms,join,calls,recordings,admin,settings,livekit}.ts` — every request schema and
      response type in `docs/API.md`; `settingsSchema` + `SETTINGS_DEFAULTS`; `publicConfigSchema`.
- [ ] `shared/utils/error-codes/index.ts` (`COMMON_ERRORS`, `AUTH_ERRORS`, `ROOM_ERRORS`, `RECORDING_ERRORS`,
      `ERROR_MESSAGES`, `ErrorCode`, `errorMessage()`); `shared/utils/permissions.ts` (`CALL_ACTIONS`, `canPerform`);
      `shared/utils/display-name.ts`; tests colocated.
- [ ] `app/lib/e2ee/{encoding,keys,envelope,fragment,index}.ts` with tests: `generateRoomKey`, `generateSlug`,
      `deriveJoinProof`, `deriveMeetingKeys`, `formatSafetyCode`, `sealAppMessage`/`openAppMessage`,
      `parseRoomFragment`, `buildRoomLink`, `parseTokenFragment`.
- [ ] `server/contracts/index.ts`: `Clock`, `EventBus` + `BusEvent`, `RoomServiceAdapter`, `ParticipantPermissionSpec`,
      `LiveRoomInfo`, `LiveParticipantInfo`, `PublishRoomState`.
- [ ] `app/lib/contracts/call.ts` (`CallContext`, `ParticipantView`, `CallPhase`, registries, `defineCallFeature`) and
      `app/lib/contracts/test-hooks.ts` (`BlinqTestHooks`, `testHooks()`).
- [ ] `server/utils/api-error.ts` (`apiError(code, statusCode, details?)`, `notImplemented(owner)`);
      `app/composables/useApi.ts` (`useApi()`, `ApiError`).
### W0a — env, stubs, dev stack, scripts, test config
- [ ] `server/utils/env.ts` (zod, parsed once, errors name the variable, placeholder secrets refused) + `.env.example`
      and `.env.dev.example` with every variable from `docs/API.md` (Environment section); `server/utils/env.test.ts`.
- [ ] 501 stub (`throw notImplemented('<owner>')`) for every route in `docs/API.md` under `server/api/**`.
- [ ] Stub pages: `app/pages/{index,dashboard,login,register,invite,verify-email,forgot-password,reset-password,change-password}.vue`,
      `app/pages/settings/{index,sessions}.vue`, `app/pages/rooms/[id].vue`, `app/pages/m/[slug].vue`,
      `app/pages/recordings/{index,[id]}.vue`, `app/pages/admin/{index,users,invites,settings,rooms,recordings,audit}.vue`,
      `app/dev/CallHarness.vue`.
- [ ] `server/cli.ts` (`migrate`, `bootstrap`, `reset-password <email>`) with stubs in
      `server/services/session/{bootstrap,reset-password}.ts`; `scripts/build-cli.mjs` bundles it to
      `.output/server/cli.mjs`.
- [ ] `docker-compose.dev.yml`: `name: blinq-dev`; Postgres 18 on `127.0.0.1:${DEV_PG_PORT:-55432}`; LiveKit v1.13.7
      in bridge mode (`127.0.0.1:7880`, `${LIVEKIT_NODE_IP}:7881/tcp`, `${LIVEKIT_NODE_IP}:7882/udp` mux, `node_ip`
      from `scripts/detect-ip.sh`, `room.auto_create: false`, webhooks to `host.docker.internal:3000…3005`,
      `host-gateway`); Mailpit on `127.0.0.1:1025` and `127.0.0.1:8025`.
- [ ] First versions of `scripts/check-english.mjs` (Cyrillic over `git ls-files`), `scripts/with-lock.sh`,
      `scripts/detect-ip.sh`, `scripts/worktree-setup.mjs <agent> <port>` (frozen-lockfile install, DB
      `blinq_<agent>`, migrate, vendor assets, `PORT`/`DATABASE_URL`).
- [ ] `vitest.config.ts` projects `unit`, `nuxt` (`app/**/*.nuxt.test.ts`), `api` (`tests/api/**`, globalSetup
      `tests/api/_harness/global-setup.ts`); `playwright.config.ts` projects `chromium`, `firefox`, `webkit-ui` (`@ui`),
      `mobile-chromium` (`@responsive`), 1 worker, `E2E_BASE_URL`.
- [ ] Commit W0a; record the wave base SHA in `docs/ROADMAP.md`.
### W0b — server-core
- [ ] Sessions (`server/services/session/**`): 32 random bytes, `sessions.id` = sha256 hex, cookie
      `__Host-blinq_session` (dev `blinq_session`; httpOnly, Secure in prod, SameSite=Lax, Path=/), absolute expiry
      30 d (`expires_at`), idle 7 d (`last_seen_at`, written at most once per minute (decision)), in-process cache ≤ 30 s
      evicted on revoke, rotate, revoke one/all.
- [ ] `server/middleware/*`: request id (`X-Request-Id`, never trusted from clients), session resolution, CSRF
      (mutating `/api/**` requests need `Origin` = origin of `PUBLIC_URL` and `Sec-Fetch-Site: same-origin` when
      present; `/api/webhooks/livekit` exempt; 403 `CSRF_REJECTED`), and the forced-password-change guard (403
      `AUTH_PASSWORD_CHANGE_REQUIRED` except `GET /api/auth/me`, `POST /api/auth/password`, `POST /api/auth/logout`,
      `GET /api/{config,health,ready}`) (decision: server-core builds the guard because it owns
      `server/middleware/**`; `auth` tests it).
- [ ] `server/utils/*`: `requireUser` (401 `UNAUTHENTICATED`), `requireAdmin` (403 `FORBIDDEN`), `resolveCaller(event,
      roomId)` (session user or the room's guest cookie `__Host-blinq_g_<slug>`, resolved to the caller's own
      `call_participants` row; 403 `CALL_NOT_PARTICIPANT`); client IP (`X-Forwarded-For` trusted only from loopback;
      IPv6 keyed by /64); limiter (`createLimiter`, exponential backoff, keys `email:`, `ip:`, `net:`, room+IP, user;
      memory store + `login_throttle` store; 429 `RATE_LIMITED` with `Retry-After`); argon2id (`algorithm: 2`,
      m=19456, t=2, p=1) with a dummy-hash verify and a semaphore (4 concurrent (decision)); consola logger
      (`LOG_LEVEL`, `LOG_FORMAT`, request id, redaction of passwords, tokens, proofs, cookies, `authorization`,
      `#k=`/`#t=` fragments); in-process `EventBus` implementation.
- [ ] `server/plugins/*`: assert `NITRO_HOST=127.0.0.1` in production; one-line startup summary (version,
      `PUBLIC_URL`, TURN on/off, SMTP on/off, registration mode).
- [ ] `server/api/health.get.ts`, `ready.get.ts`, `config.get.ts` exactly as `docs/API.md` (Public section).
- [ ] CLI: `migrate`, `bootstrap` (only when zero admins and `system.bootstrapDone` unset; admin from
      `ADMIN_EMAIL`/`ADMIN_PASSWORD` with `must_change_password`), `reset-password <email>` (stdin, revokes sessions,
      audit); PG advisory lock, DB retry, idempotent.
- [ ] `server/services/settings/**` (cached, validated, write-through, publishes nothing secret) and
      `server/services/audit/**` (`audit(event, { action, targetType, targetId, details })`, actions `<domain>.<verb>`).
- [ ] `server/tasks/maintenance/{cleanup,retention}.ts`: expired sessions, invites, guest sessions, email tokens,
      throttle rows; IP retention (`privacy.ipRetentionDays`) and audit retention (`audit.retentionDays`).
- [ ] API harness `tests/api/_harness/**`: build once (`pnpm build:test` under `scripts/with-lock.sh`), DB
      `blinq_test_api`, start `.output/server/index.mjs`, `provide('apiBaseUrl')`; helpers for cookie jars, `Origin`
      header, factories (users, admins, sessions, rooms with a known key, invites, meetings), Mailpit client.
### W0b — ui-shell
- [ ] Layouts `app/layouts/{default,auth,admin,call}.vue`; shell and nav in `app/components/app/**` (user menu, theme
      toggle, admin entries only for admins); responsive (nav in a sheet on phones).
- [ ] Theme: light/dark/system via color-mode, system by default, persisted, no flash on SSR (the color-mode head
      script runs before paint and carries the CSP nonce).
- [ ] `app/error.vue` (404/403/500, no stack traces), `app/assets/css/tailwind.css` (theme tokens, Inter variable
      font self-hosted), `app/pages/index.vue` (landing; signed-in users go to `/dashboard`).
- [ ] `app/plugins/00.fragment.client.ts` (`enforce: 'pre'`): before the initial navigation, reads `location.hash`,
      keeps secrets in sessionStorage (`blinq:fragment:<path>`), strips the hash with `history.replaceState`, and
      provides `$fragment.take(path)` for pages (decision); parsing uses `parseRoomFragment` / `parseTokenFragment`.
- [ ] Post-login redirects accept only relative `route.path` values starting with a single `/`.
### W0b — devops-ci
- [x] `ci.yml`: install + `git diff --exit-code`, lint, typecheck, unit, `check:english`, gitleaks, actionlint,
      `build` and `build:test` (prod bundle has no `__blinqTest`, `/dev/call` returns 404), API tests (Postgres service,
      Mailpit, fake RoomService, a small real-LiveKit job).
- [x] `e2e.yml` (dev compose with `node_ip` = runner eth0 IP, test build, e2e Caddy, Chromium + Firefox, WebKit UI-only,
      ffmpeg/ffprobe from `mwader/static-ffmpeg:9.0.2`), `docker.yml`, `nightly.yml`, `release.yml` (prepared,
      `workflow_dispatch` only); actions pinned by SHA.
- [x] Healthchecks in `docker-compose.dev.yml` so `up -d --wait` blocks until Postgres, LiveKit and Mailpit are healthy.
- [x] `docker/e2e/Caddyfile`: `http://localhost:8080`, `/rtc*` → LiveKit 7880, `/api/webhooks/*` → 404, everything else
      → the app; production CSP unchanged.
- [x] `tests/e2e/fixtures/base.ts`: fail on `securitypolicyviolation`, console errors, secrets in app/Caddy logs.
- [x] `tests/e2e/shell/`-independent smoke spec proposed to `ui-shell`; `docs/TESTING.md` updated as built.
      (Smoke specs: `tests/e2e/smoke/`. The `docs/TESTING.md` text is in the devops-ci report, because that file is
      being edited on main.)

## Tests
- Unit: `server/utils/env.test.ts`, `shared/utils/{display-name,permissions}.test.ts`, `app/lib/e2ee/*.test.ts` (W0a);
  limiter, password, logger and session tests colocated under `server/utils/` and `server/services/session/`
  (server-core).
- API: `tests/api/core/stubs.test.ts` (every unimplemented route answers 501 with the envelope),
  `tests/api/core/health.test.ts` (`/api/health` 200; `/api/ready` 503 without DB), `tests/api/core/config.test.ts`
  (matches `publicConfigSchema`), `tests/api/core/csrf.test.ts`, `tests/api/core/cli.test.ts` (migrate and bootstrap
  twice → same state; reset-password revokes sessions).
- E2E: `tests/e2e/shell/home.spec.ts` (`@ui`: CSP header, no violations), `tests/e2e/shell/theme.spec.ts` (system
  default, persists, no flash), `tests/e2e/shell/fragment.spec.ts` (hash stripped before middleware, values kept),
  `tests/e2e/shell/responsive.spec.ts` (`@responsive`, no horizontal overflow at 375/768/1440).

## Definition of Done
- [ ] [auto] `docker compose -f docker-compose.dev.yml up -d --wait` exits 0 — evidence: `pnpm dev:deps` in e2e.yml.
- [ ] [agent-manual] `pnpm dev` works — evidence: `curl -fsS http://localhost:3000/` returns 200 with a CSP header.
- [ ] [auto] `lint`, `typecheck`, `test`, `build` and `check:english` are green — evidence: ci.yml.
- [ ] [auto] Install leaves no diff — evidence: ci.yml install step (`git diff --exit-code`).
- [ ] [agent-manual] `pnpm root` is inside the repo — evidence: `pnpm root` output in the W0a report.
- [ ] [auto] Migrate is idempotent and bootstrap is idempotent — evidence: `tests/api/core/cli.test.ts`.
- [ ] [auto] `actionlint` and gitleaks pass — evidence: ci.yml jobs.
- [ ] [auto] The home page has a CSP and no violations — evidence: `pnpm test:e2e -- shell/home`.
- [ ] [auto] Env errors name the variable; placeholder secrets are refused — evidence: `server/utils/env.test.ts`.
- [ ] [auto] Dark/light theme persists, follows the system by default, and SSR has no flash — evidence:
      `pnpm test:e2e -- shell/theme`.
- [ ] [auto] Every route in `docs/API.md` exists (501 until implemented) — evidence: `tests/api/core/stubs.test.ts`.
- [ ] [auto] Health, readiness, config and CSRF behave as documented — evidence: `tests/api/core/*.test.ts`.
- [ ] [auto] The prod build has no `__blinqTest` and `/dev/call` returns 404 — evidence: ci.yml build job.
- [ ] [auto] Fragments are stripped before any middleware runs — evidence: `pnpm test:e2e -- shell/fragment`.
- [ ] [auto] No horizontal overflow at 375/768/1440 px — evidence: `pnpm test:e2e -- shell/responsive`.
- [ ] [agent-manual] Wave base SHA recorded in `docs/ROADMAP.md` — evidence: ROADMAP "Wave base SHAs" table.

## Notes and gotchas
- A stray pnpm workspace in `$HOME` captures installs unless the repo has its own `pnpm-workspace.yaml`.
- pnpm 11 blocks dependency build scripts not listed in `allowBuilds`; a missing entry breaks `@node-rs/argon2`.
- Nitro v2 does not await async plugins: migrations and bootstrap run in the CLI before the server starts.
- `NODE_ENV` is inlined at build time; test-only code keys off `__BLINQ_TEST_HOOKS__` (`pnpm build:test`).
- Never put tests under `server/api|routes|middleware|plugins|tasks`. Keep h3 at 1.15; never add h3 v2.
- nuxt-security's default Permissions-Policy blocks camera and microphone; the override must stay.
- Dev LiveKit advertises the LAN IP (Firefox rejects loopback candidates); its media ports are published on that IP.
- The dev stack is shared by all agents: never `docker compose down` it. Heavy commands run under
  `scripts/with-lock.sh`.
- API tests age rows in the test DB instead of injecting a clock into the built server (decision).
