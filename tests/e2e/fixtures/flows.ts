import { test as base } from '@playwright/test'

/**
 * Real-flow fixtures (Wave 3, owner `e2e-flows`): sign-in, room creation, invite links, guests and admission through
 * the product UI at `/m/[slug]` instead of the `/dev/call` harness. Committed as a stub so `index.ts` stays frozen.
 */
export const test = base.extend({})
