#!/usr/bin/env node
/**
 * Checks the build in .output (CI: ci.yml, job build).
 *
 *   node scripts/check-build.mjs production   after `pnpm build`: no test hooks, no harness, /dev/** is a real 404
 *   node scripts/check-build.mjs test         after `pnpm build:test`: the harness page and the test route exist
 *
 * Besides scanning the files, it starts the built server on a free loopback port and first proves that the server
 * answering is this very build (build id): a Nitro server that cannot bind its port logs EADDRINUSE but keeps
 * running, so probing a fixed port can silently reach an older dev or test server.
 */
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const mode = process.argv[2]
if (mode !== 'production' && mode !== 'test') {
  console.error('usage: node scripts/check-build.mjs <production|test>')
  process.exit(2)
}

const failures = []
function check(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}

// --- Files -------------------------------------------------------------------------------------------------------

function* walk(dir, pattern) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path, pattern)
    else if (pattern.test(entry.name)) yield path
  }
}

// Shipped code only: source maps are not executed.
const SHIPPED = /\.(m?js|cjs|json|html|css)$/
const files = [...walk('.output/public', SHIPPED), ...walk('.output/server', SHIPPED)].map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}))
const containing = (needle) => files.filter((file) => file.text.includes(needle)).map((file) => file.path)

/** Strings that exist only in dev and test builds (harness page, test route, browser test hooks). */
const TEST_ONLY = {
  '__blinqTest (window.__blinqTest test hooks)': '__blinqTest',
  'CallHarness (the /dev/call harness page)': 'CallHarness',
  '"/dev/call" (harness route)': '"/dev/call"',
  '/api/__test/ (test-only API route)': '/api/__test/',
}
// The build flag is a compile-time constant: any identifier left over means the define did not apply.
check(containing('__BLINQ_TEST_HOOKS__').length === 0, 'no unreplaced __BLINQ_TEST_HOOKS__ identifier')

if (mode === 'production') {
  for (const [label, needle] of Object.entries(TEST_ONLY)) {
    const found = containing(needle)
    check(found.length === 0, `production bundle has no ${label}${found.length ? `: ${found.join(', ')}` : ''}`)
  }
} else {
  check(
    containing('CallHarness').some((path) => path.startsWith('.output/public/')),
    'test build has the harness chunk',
  )
  check(containing('"/dev/call"').length > 0, 'test build registers /dev/call')
  // Once app code uses testHooks(), the test build must carry window.__blinqTest.
  const appUsesHooks = [...walk('app', /\.(ts|vue)$/)].some(
    (path) => !path.includes('/lib/contracts/') && readFileSync(path, 'utf8').includes('testHooks('),
  )
  if (appUsesHooks) check(containing('__blinqTest').length > 0, 'test build has window.__blinqTest')
}

// --- Running server ------------------------------------------------------------------------------------------------

const buildId = JSON.parse(readFileSync('.output/public/_nuxt/builds/latest.json', 'utf8')).id

const port = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address()
    probe.close(() => resolve(free))
  })
})
const origin = `http://127.0.0.1:${port}`

// Public dev values only; nothing on these routes needs the database or LiveKit.
const env = {
  ...process.env,
  ...parseEnv(readFileSync('.env.dev.example', 'utf8')),
  NODE_ENV: 'production',
  NITRO_HOST: '127.0.0.1',
  NITRO_PORT: String(port),
  PORT: String(port),
  PUBLIC_URL: origin,
  LIVEKIT_PUBLIC_URL: `ws://127.0.0.1:${port}`,
  // The test-only GET /api/__test/livekit-calls answers 404 unless the in-memory fake RoomService is in use.
  ...(mode === 'test' ? { LIVEKIT_URL: 'fake://local' } : {}),
  LOG_LEVEL: 'warn',
}
const server = spawn(process.execPath, ['.output/server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
server.stdout.on('data', (chunk) => (output += chunk))
server.stderr.on('data', (chunk) => (output += chunk))

const get = (path, accept = 'text/html') =>
  fetch(`${origin}${path}`, { headers: { accept }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })

try {
  let served
  for (let attempt = 0; attempt < 60 && served === undefined && server.exitCode === null; attempt++) {
    try {
      const response = await get('/_nuxt/builds/latest.json', 'application/json')
      if (response.ok) served = (await response.json()).id
    } catch {
      // not listening yet
    }
    if (served === undefined) await sleep(500)
  }
  check(served === buildId, `the server on ${origin} serves this build (id ${buildId})`)

  if (served === buildId) {
    if (mode === 'production') {
      for (const path of ['/dev/call', '/dev', '/dev/', '/dev/call/nested']) {
        const status = (await get(path)).status
        check(status === 404, `GET ${path} is 404 (got ${status})`)
      }
      const status = (await get('/api/__test/livekit-calls', 'application/json')).status
      check(status === 404, `GET /api/__test/livekit-calls is 404 (got ${status})`)
    } else {
      const response = await get('/dev/call')
      const html = await response.text()
      check(
        response.status === 200 && html.includes('data-ssr="false"'),
        `GET /dev/call is the client-only harness page (got ${response.status})`,
      )
      const status = (await get('/api/__test/livekit-calls', 'application/json')).status
      check(status !== 404, `GET /api/__test/livekit-calls exists (got ${status})`)
    }
  }
} finally {
  server.kill('SIGTERM')
}

if (output.includes('EADDRINUSE')) failures.push('the built server could not bind its port')
if (failures.length > 0) {
  console.error(
    `\ncheck-build (${mode}): ${failures.length} check(s) failed.\n--- server output ---\n${output.slice(-4000)}`,
  )
  process.exit(1)
}
console.log(`\ncheck-build (${mode}): all checks passed`)
