/**
 * zod 4 compiles object parsers with `Function()` unless `jitless` is set. The production CSP has no 'unsafe-eval', so
 * the attempt is blocked and reported as a CSP violation on every page that builds an object schema (forms).
 *
 * zod keeps its settings on this global and reads `jitless` when a schema is created. Plugin modules are evaluated
 * before any page chunk, so setting it at module evaluation (without importing zod, whose chunk may carry schemas)
 * covers every client-side schema. The server has no CSP and keeps the faster JIT parsers.
 */
const holder = globalThis as { __zod_globalConfig?: { jitless?: boolean } }
holder.__zod_globalConfig ??= {}
holder.__zod_globalConfig.jitless = true

export default defineNuxtPlugin({ name: 'blinq:zod-jitless' })
