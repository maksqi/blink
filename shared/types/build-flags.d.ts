/**
 * Compile-time flag replaced by Vite (client) and Nitro (server). True only in `pnpm build:test` output and in dev.
 * Test-only code must be wrapped in `if (__BLINQ_TEST_HOOKS__) { ... }` so production bundles drop it.
 */
declare const __BLINQ_TEST_HOOKS__: boolean
