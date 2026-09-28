import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against a test build (`pnpm build:test`) served behind docker/e2e/Caddyfile, so the app and LiveKit
 * signaling are same-origin and the production CSP applies unchanged. Details: docs/TESTING.md.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const isCI = Boolean(process.env.CI)

const chromiumMediaArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
  '--auto-accept-this-tab-capture',
  '--autoplay-policy=no-user-gesture-required',
]

const firefoxMediaPrefs = {
  'media.navigator.streams.fake': true,
  'media.navigator.permission.disabled': true,
  'permissions.default.camera': 1,
  'permissions.default.microphone': 1,
  'media.autoplay.default': 0,
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: chromiumMediaArgs } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: firefoxMediaPrefs } },
    },
    {
      // Linux WebKit lacks RTCRtpScriptTransform (E2EE): UI-only specs tagged @ui.
      name: 'webkit-ui',
      grep: /@ui/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chromium',
      grep: /@responsive/,
      use: { ...devices['Pixel 7'], launchOptions: { args: chromiumMediaArgs } },
    },
  ],
})
