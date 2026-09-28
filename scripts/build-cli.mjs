#!/usr/bin/env node
/**
 * Bundles server/cli.ts into .output/server/cli.mjs (next to Nitro's traced node_modules, so the native
 * @node-rs/argon2 binding resolves at runtime). Runs after `nuxt build`.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['server/cli.ts'],
  outfile: '.output/server/cli.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Native addon: resolved from .output/server/node_modules (traced by Nitro).
  external: ['@node-rs/argon2'],
  // Resolves `#shared/*` and friends the same way Nitro does.
  tsconfig: '.nuxt/tsconfig.server.json',
  define: { __BLINQ_TEST_HOOKS__: JSON.stringify(process.env.BLINQ_TEST_HOOKS === '1') },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
})
