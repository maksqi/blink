/**
 * zod 4 probes whether the page may compile code at runtime (a Function constructor call) when it builds its first
 * object schema, to decide whether to JIT-compile parsers. Under blinq's CSP (no 'unsafe-eval') the probe is blocked
 * and the browser reports a `securitypolicyviolation`, even though zod catches the error. Parsing without JIT skips
 * the probe.
 *
 * Import this module before anything that defines schemas (`#shared/schemas/*`). (decision; the orchestrator is asked
 * to move this into an app-wide early plugin.)
 */
import { config } from 'zod'

config({ jitless: true })
