/**
 * Build, server and CLI processes for API tests.
 *
 * - `buildTestServer()`: `pnpm build:test` once per run, under `scripts/with-lock.sh` (directly when an ancestor
 *   process already holds the lock, e.g. `sh scripts/with-lock.sh pnpm test:api`). `API_TEST_SKIP_BUILD=1` reuses
 *   an existing `.output` (it must be a test build).
 * - `startTestServer(env)`: runs `.output/server/index.mjs` on a free loopback port and waits for /api/health.
 *   Usable from test files too (e.g. a second server without a database).
 * - `runCli(args, env, stdin?)`: runs the bundled `.output/server/cli.mjs`.
 */
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { REPO_ROOT } from './environment'

const LOCK_DIR = process.env.BLINQ_LOCK_DIR ?? '/tmp/blinq-heavy.lock'

function tail(file: string, lines = 60): string {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}

/** True when the machine-wide heavy-work lock is held by this process or one of its ancestors. */
function lockHeldByAncestor(): boolean {
  let holder: string
  try {
    holder = readFileSync(join(LOCK_DIR, 'pid'), 'utf8').trim()
  } catch {
    return false
  }
  let pid = process.pid
  for (let depth = 0; depth < 32 && pid > 1; depth++) {
    if (String(pid) === holder) return true
    try {
      pid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
    } catch {
      return false
    }
  }
  return false
}

/** The caller's environment without Vitest's markers, so the build equals a plain `pnpm build:test`. */
function buildEnvironment(): NodeJS.ProcessEnv {
  const vitestMarker = (key: string) => key === 'NODE_ENV' || key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_')
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !vitestMarker(key)))
}

function run(command: string, args: string[], logFile: string): Promise<number> {
  mkdirSync(dirname(logFile), { recursive: true })
  const fd = openSync(logFile, 'w')
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', fd, fd], env: buildEnvironment() })
    child.on('error', reject)
    child.on('exit', (code) => {
      closeSync(fd)
      resolve(code ?? 1)
    })
  })
}

export async function buildTestServer(logFile: string): Promise<void> {
  const built = existsSync(join(REPO_ROOT, '.output/server/index.mjs')) && existsSync(join(REPO_ROOT, '.output/server/cli.mjs'))
  if (process.env.API_TEST_SKIP_BUILD === '1' && built) return
  const [command, args] = lockHeldByAncestor()
    ? ['pnpm', ['build:test']]
    : ['sh', ['scripts/with-lock.sh', 'pnpm', 'build:test']]
  const code = await run(command as string, args as string[], logFile)
  if (code !== 0) throw new Error(`pnpm build:test failed (exit ${code}). Last lines of ${logFile}:\n${tail(logFile)}`)
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

export interface TestServer {
  baseUrl: string
  port: number
  logFile: string
  stop(): Promise<void>
}

export async function startTestServer(
  env: Record<string, string>,
  options: { logFile: string; timeoutMs?: number; publicUrl?: string; host?: string },
): Promise<TestServer> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  mkdirSync(dirname(options.logFile), { recursive: true })
  const fd = openSync(options.logFile, 'a')
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', fd, fd],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...env,
      // Every server is its own origin (links, cookies and CSRF checks) unless a test says otherwise.
      PUBLIC_URL: options.publicUrl ?? baseUrl,
      NITRO_HOST: options.host ?? '127.0.0.1',
      NITRO_PORT: String(port),
    },
  })
  closeSync(fd)
  let exited: number | null | undefined
  const exit = new Promise<void>((resolve) =>
    child.once('exit', (code) => {
      exited = code
      resolve()
    }),
  )

  const deadline = Date.now() + (options.timeoutMs ?? 30_000)
  while (true) {
    if (exited !== undefined) {
      throw new Error(`Test server exited early (code ${exited}). Log ${options.logFile}:\n${tail(options.logFile)}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) break
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`Test server did not become healthy in time. Log ${options.logFile}:\n${tail(options.logFile)}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  return {
    baseUrl,
    port,
    logFile: options.logFile,
    async stop() {
      if (exited !== undefined) return
      child.kill('SIGTERM')
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await exit
      clearTimeout(killer)
    },
  }
}

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

export function runCli(args: string[], env: Record<string, string>, stdin?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['.output/server/cli.mjs', ...args], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(stdin ?? '')
  })
}
