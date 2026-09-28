import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * Production smoke test (Stage 09a). scripts/smoke-prod.sh starts the production compose stack with TLS_MODE=internal
 * and runs this config in the pinned Playwright image on the host network, with the repository mounted read-only:
 *   node node_modules/@playwright/test/cli.js test -c tests/smoke-prod/playwright.config.ts
 * Results and the report go to SMOKE_OUTPUT_DIR (logs/smoke-prod on the host).
 */
const outputDir = process.env.SMOKE_OUTPUT_DIR ?? fileURLToPath(new URL('../../logs/smoke-prod', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: `${outputDir}/results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: `${outputDir}/report` }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'https://blinq.localhost',
    // Caddy's internal CA. The Node-level checks verify the chain against its root instead (support.ts).
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // The page checks run in Firefox too; call.spec.ts starts both browsers itself.
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: 'pages.spec.ts' },
  ],
})
