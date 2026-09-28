/**
 * Reads a password for the CLI (server-core). Passwords never come from argv (process lists, shell history).
 * - Terminal: prompt on stderr, raw mode without echo; Backspace edits, Enter finishes, Ctrl-C aborts.
 * - Pipe or file: the first line of stdin (`printf '%s\n' "$PASSWORD" | cli reset-password a@b.c`).
 */
import type { Readable, Writable } from 'node:stream'

export class PromptAbortedError extends Error {
  constructor() {
    super('aborted')
    this.name = 'PromptAbortedError'
  }
}

type Input = Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown }

const CTRL_C = 3
const CTRL_D = 4
const BACKSPACE = 8
const DELETE = 127

export function readPassword(options: { prompt: string; input?: Input; output?: Writable }): Promise<string> {
  const input = options.input ?? (process.stdin as Input)
  const output = options.output ?? process.stderr
  return input.isTTY && input.setRawMode ? readFromTerminal(input, output, options.prompt) : readFirstLine(input)
}

function readFromTerminal(input: Input, output: Writable, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ''
    output.write(prompt)
    input.setRawMode!(true)
    input.setEncoding('utf8')
    input.resume()

    const finish = (error?: Error) => {
      input.off('data', onData)
      input.setRawMode!(false)
      input.pause()
      output.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk: string) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0)
        if (char === '\r' || char === '\n') return finish()
        if (code === CTRL_C) return finish(new PromptAbortedError())
        if (code === CTRL_D) return value ? finish() : finish(new PromptAbortedError())
        if (code === DELETE || code === BACKSPACE) value = Array.from(value).slice(0, -1).join('')
        else if (code >= 32) value += char
      }
    }
    input.on('data', onData)
  })
}

function readFirstLine(input: Input): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const done = () => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onError)
      input.pause()
      resolve(buffer.split(/\r?\n/, 1)[0] ?? '')
    }
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      if (buffer.includes('\n')) done()
    }
    const onEnd = () => done()
    const onError = (error: Error) => reject(error)
    input.on('data', onData)
    input.on('end', onEnd)
    input.on('error', onError)
    input.resume()
  })
}
