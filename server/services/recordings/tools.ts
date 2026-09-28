/**
 * Runs ffmpeg/ffprobe as locked-down child processes (docs/SECURITY.md §6):
 * - the environment is PATH only (no secrets, no DATABASE_URL, no RECORDING_ENCRYPTION_KEY);
 * - lowered CPU priority (`nice` 10);
 * - SIGKILL after the timeout or when the job is aborted (admin delete, shutdown);
 * - stdin is fed from an async iterable with backpressure (optionally capped), stdout/stderr are size-capped.
 * An error thrown by the input (for example a BLQ1 integrity failure) kills the tool and is reported as `inputError`.
 */
import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const TOOL_NICENESS = 10
export const STDERR_LIMIT_BYTES = 64 * 1024

export interface RunToolOptions {
  input?: AsyncIterable<Buffer>
  /** Stop feeding stdin after this many bytes. */
  inputLimitBytes?: number
  timeoutMs: number
  signal?: AbortSignal
  stdoutLimitBytes?: number
}

export interface ToolResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  inputError: unknown
}

/** The child's environment: PATH only. */
export function toolEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' }
}

async function* capped(source: AsyncIterable<Buffer>, limit: number): AsyncGenerator<Buffer> {
  let sent = 0
  for await (const chunk of source) {
    if (sent >= limit) return
    const room = limit - sent
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk
    sent += part.length
    yield part
    if (sent >= limit) return
  }
}

class Collector {
  private parts: Buffer[] = []
  private size = 0
  constructor(private readonly limit: number) {}
  push = (chunk: Buffer) => {
    if (this.size >= this.limit) return
    const part = chunk.subarray(0, this.limit - this.size)
    this.parts.push(part)
    this.size += part.length
  }
  text() {
    return Buffer.concat(this.parts).toString('utf8')
  }
}

function isBrokenPipe(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ERR_STREAM_DESTROYED' || code === 'ECONNRESET'
}

export function runTool(command: string, args: string[], options: RunToolOptions): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: true, inputError: undefined })
      return
    }
    const child = spawn(command, args, {
      env: toolEnvironment(),
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let settled = false
    let timedOut = false
    let aborted = false
    let inputError: unknown
    const stdout = new Collector(options.stdoutLimitBytes ?? 1024 * 1024)
    const stderr = new Collector(STDERR_LIMIT_BYTES)

    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, options.timeoutMs)
    const onAbort = () => {
      aborted = true
      kill()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    child.once('spawn', () => {
      try {
        if (child.pid) setPriority(child.pid, TOOL_NICENESS)
      } catch {
        // Lowering our own child's priority is always allowed; ignore platforms that refuse anyway.
      }
    })
    child.stdout?.on('data', stdout.push)
    child.stderr?.on('data', stderr.push)

    let inputDone: Promise<void> = Promise.resolve()
    if (options.input && child.stdin) {
      const source = options.inputLimitBytes === undefined ? options.input : capped(options.input, options.inputLimitBytes)
      inputDone = pipeline(Readable.from(source), child.stdin).catch((error: unknown) => {
        // The tool may stop reading early (ffprobe does); anything else came from the input and ends the run.
        if (isBrokenPipe(error)) return
        inputError = error
        kill()
      })
    }

    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      kill()
      reject(error)
    })
    child.once('close', (code, signal) => {
      void inputDone.then(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ code, signal, stdout: stdout.text(), stderr: stderr.text(), timedOut, aborted, inputError })
      })
    })
  })
}

/** First line of a tool's stderr, shortened, for logs (never file contents). */
export function stderrSummary(stderr: string): string {
  const line = stderr.split('\n').find((l) => l.trim()) ?? ''
  return line.trim().slice(0, 300)
}
