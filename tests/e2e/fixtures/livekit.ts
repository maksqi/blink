import { test as base } from '@playwright/test'

/**
 * LiveKit fixtures (owner: call-core, Stage 05): `joinAs(role)` mints tokens with livekit-server-sdk and opens the
 * /dev/call harness. rooms-backend adds the DB-backed variant in tests/e2e/fixtures/join.ts (Stage 04).
 * W0a stub — keep the export name; index.ts merges it.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}>({})
