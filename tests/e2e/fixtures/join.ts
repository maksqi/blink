import { test as base } from '@playwright/test'

/**
 * DB-backed join fixtures (owner: rooms-backend, Stage 04): creates rooms/invites and joins through the real join API,
 * so in-call endpoints see real call_participants rows. W0a stub — keep the export name; index.ts merges it.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}>({})
