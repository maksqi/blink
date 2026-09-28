/**
 * Feature discovery: every `app/lib/call/features/<feature>/index.ts` default-exports a `defineCallFeature({...})`.
 * Adding a folder is enough; no core file changes (docs/ARCHITECTURE.md §4). Duplicate ids throw in dev.
 */
import type { CallFeature } from '../contracts/call'
import { buildRegistry } from './registry'

const modules = import.meta.glob<{ default: CallFeature }>('./features/*/index.ts', { eager: true })

export const callRegistry = buildRegistry(modules, { strict: import.meta.dev === true })
