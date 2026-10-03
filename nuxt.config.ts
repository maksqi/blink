import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build-time flags.
 * - `nuxi dev` sets NODE_ENV=development before this file is evaluated.
 * - BLINQ_TEST_HOOKS=1 produces a test build (harness pages + window.__blinqTest). Never use it for production.
 *   NODE_ENV is inlined at build time, so test-only code must key off this flag instead.
 */
const isDev = process.env.NODE_ENV === 'development'
const isTestBuild = process.env.BLINQ_TEST_HOOKS === '1'

/** Dev only: LiveKit runs on its own port in docker-compose.dev.yml. Production and E2E are same-origin. */
const devConnectSources = isDev ? ['ws://localhost:7880', 'http://localhost:7880'] : []

// Sub-agent worktrees live in <repo>/.claude/worktrees/<name>. Ignore them only under THIS checkout's root: an
// unanchored ".claude" glob would also match the absolute path of a worktree itself and disable HMR inside it.
const rootDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')
const worktreesGlob = `${rootDir}/.claude/**`

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: isDev },

  modules: [
    '@nuxtjs/color-mode',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    'nuxt-security',
    'shadcn-nuxt',
    '@nuxt/eslint',
    '@nuxt/test-utils/module',
  ],

  css: ['~/assets/css/tailwind.css'],

  app: {
    head: {
      title: 'blinq',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Self-hosted, end-to-end encrypted video meetings.' },
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
    },
  },

  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'blinq-color-mode',
  },

  shadcn: { prefix: '', componentDir: '@/components/ui' },

  eslint: { config: { stylistic: false } },

  typescript: { strict: true, typeCheck: false },

  // Parallel sub-agents keep git worktrees under .claude/worktrees — never scan or watch them.
  ignore: [worktreesGlob],
  watchers: { chokidar: { ignored: [worktreesGlob, `${rootDir}/public/vendor/**`] } },

  vite: {
    plugins: [tailwindcss()],
    define: { __BLINQ_TEST_HOOKS__: JSON.stringify(isTestBuild) },
    server: { watch: { ignored: [worktreesGlob] } },
    worker: { format: 'es' },
  },

  routeRules: {
    // The call page is client-only: no SSR payload, no hydration cost, key never rendered server-side.
    '/m/**': { ssr: false },
    // Harness pages exist only in dev/test builds; in production /dev/** must stay a real 404 (no SPA shell).
    ...(isDev || isTestBuild ? { '/dev/**': { ssr: false } } : {}),
    // Recording chunk uploads are the only large request bodies (handler enforces the exact per-chunk limit).
    '/api/recordings/**': {
      security: { requestSizeLimiter: { maxRequestSizeInBytes: 20_000_000, maxUploadFileRequestInBytes: 20_000_000 } },
    },
    // Nitro knows no MIME type for .tflite and would serve the blur model as text/plain.
    '/vendor/mediapipe/selfie_segmenter.tflite': { headers: { 'content-type': 'application/octet-stream' } },
  },

  security: {
    nonce: true,
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'", "'wasm-unsafe-eval'"],
        // blob: is needed only by the @livekit/track-processors frame timer worker.
        'worker-src': ["'self'", 'blob:'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", ...devConnectSources],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'script-src-attr': ["'none'"],
        'upgrade-insecure-requests': false,
      },
      // nuxt-security's default blocks camera/microphone/display-capture; blinq needs them for itself only.
      permissionsPolicy: {
        camera: ['self'],
        microphone: ['self'],
        'display-capture': ['self'],
        fullscreen: ['self'],
        'speaker-selection': ['self'],
        'picture-in-picture': ['self'],
        autoplay: ['self'],
        geolocation: [],
        payment: [],
        usb: [],
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginResourcePolicy: 'same-origin',
      referrerPolicy: 'no-referrer',
      // HSTS is set by Caddy for every response (including errors and /rtc).
      strictTransportSecurity: false,
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      originAgentCluster: '?1',
      xDNSPrefetchControl: 'off',
      xPermittedCrossDomainPolicies: 'none',
    },
    // Replaced by purpose-built limiters (IP /64, account, room) in server/utils — see docs/SECURITY.md.
    rateLimiter: false,
    // False positives on legitimate input (passwords, room names) and it buffers request bodies.
    xssValidator: false,
    requestSizeLimiter: { maxRequestSizeInBytes: 1_000_000, maxUploadFileRequestInBytes: 1_000_000 },
    corsHandler: false,
    allowedMethodsRestricter: false,
    hidePoweredBy: true,
    removeLoggers: false,
  },

  nitro: {
    experimental: { tasks: true },
    scheduledTasks: {
      // Finalize recordings whose uploader vanished; process abandoned uploads.
      '*/2 * * * *': ['recordings:finalize-stale'],
      // Expired sessions, invites, guest sessions, tokens, throttle rows.
      '7 * * * *': ['maintenance:cleanup'],
      // Recording retention, IP and audit retention.
      '23 3 * * *': ['recordings:retention', 'maintenance:retention'],
    },
    replace: { __BLINQ_TEST_HOOKS__: JSON.stringify(isTestBuild) },
    // Test builds only: inspect calls made to the in-memory fake LiveKit adapter (LIVEKIT_URL=fake://local).
    handlers:
      isDev || isTestBuild
        ? [{ route: '/api/__test/livekit-calls', method: 'get', handler: '~~/server/testing/livekit-calls.get.ts' }]
        : [],
  },

  hooks: {
    // Test harness pages (app/dev/*) are registered only in dev and test builds; production has no /dev routes.
    'pages:extend'(pages) {
      if (!isDev && !isTestBuild) return
      pages.push({ name: 'dev-call', path: '/dev/call', file: fileURLToPath(new URL('./app/dev/CallHarness.vue', import.meta.url)) })
    },
  },
})
