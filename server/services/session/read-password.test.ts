import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { PromptAbortedError, readPassword } from './read-password'

function terminal() {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (mode: boolean) => void }
  input.isTTY = true
  input.setRawMode = vi.fn()
  const output = new PassThrough()
  const written: string[] = []
  output.on('data', (chunk: Buffer) => written.push(chunk.toString()))
  return { input, output, written }
}

describe('readPassword from a pipe', () => {
  it('returns the first line without the line ending', async () => {
    const input = new PassThrough()
    const result = readPassword({ prompt: 'x', input, output: new PassThrough() })
    input.end('first line secret\r\nsecond line\n')
    expect(await result).toBe('first line secret')
  })

  it('accepts input without a trailing newline and empty input', async () => {
    const one = new PassThrough()
    const a = readPassword({ prompt: 'x', input: one, output: new PassThrough() })
    one.end('no newline')
    expect(await a).toBe('no newline')
    const empty = new PassThrough()
    const b = readPassword({ prompt: 'x', input: empty, output: new PassThrough() })
    empty.end()
    expect(await b).toBe('')
  })
})

describe('readPassword from a terminal', () => {
  it('reads without echo, handles backspace and restores the terminal', async () => {
    const { input, output, written } = terminal()
    const result = readPassword({ prompt: 'New password: ', input, output })
    input.write('secreX')
    input.write(String.fromCharCode(127))
    input.write('t value\r')
    expect(await result).toBe('secret value')
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
    expect(written.join('')).toBe('New password: \n')
  })

  it('aborts on Ctrl-C', async () => {
    const { input, output } = terminal()
    const result = readPassword({ prompt: '> ', input, output })
    input.write(`abc${String.fromCharCode(3)}`)
    await expect(result).rejects.toBeInstanceOf(PromptAbortedError)
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
  })

  it('ignores control characters', async () => {
    const { input, output } = terminal()
    const result = readPassword({ prompt: '> ', input, output })
    input.write(`a${String.fromCharCode(1)}b${String.fromCharCode(27)}c\n`)
    expect(await result).toBe('abc')
  })
})
