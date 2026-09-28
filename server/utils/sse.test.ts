import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeAllSseStreams, createSseStream, formatSseComment, formatSseEvent, openSseStreamCount } from './sse'

describe('SSE formatting', () => {
  it('writes an event name, optional id and one JSON data line', () => {
    expect(formatSseEvent('status', { status: 'waiting' })).toBe('event: status\ndata: {"status":"waiting"}\n\n')
    expect(formatSseEvent('ended', {}, '7')).toBe('id: 7\nevent: ended\ndata: {}\n\n')
    expect(formatSseEvent('x', { text: 'a\nb' })).toBe('event: x\ndata: {"text":"a\\nb"}\n\n')
  })

  it('keeps names and comments on one line', () => {
    expect(formatSseEvent('a\nevent: evil', null)).toBe('event: a event: evil\ndata: {}\n\n')
    expect(formatSseComment('ping')).toBe(': ping\n\n')
    expect(formatSseComment('a\r\nb')).toBe(': a b\n\n')
  })
})

describe('createSseStream', () => {
  let server: Server | undefined
  const closedByServer: string[] = []

  afterEach(async () => {
    closeAllSseStreams()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  async function start() {
    const app = createApp()
    app.use(
      '/events',
      defineEventHandler((event) => {
        const stream = createSseStream(event, { heartbeatMs: 30 })
        stream.send('status', { status: 'waiting' })
        stream.onClose(() => closedByServer.push('closed'))
        if (new URL(event.path, 'http://x').searchParams.has('end')) {
          setTimeout(() => {
            stream.send('ended', {})
            stream.close()
          }, 80)
        }
        return stream.start()
      }),
    )
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('streams queued events, heartbeats and a final event, then closes', async () => {
    const base = await start()
    const response = await fetch(`${base}/events?end=1`)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
    const body = await response.text()
    expect(body.startsWith('event: status\ndata: {"status":"waiting"}\n\n')).toBe(true)
    expect(body).toContain(': ping\n\n')
    expect(body.endsWith('event: ended\ndata: {}\n\n')).toBe(true)
    expect(openSseStreamCount()).toBe(0)
  })

  it('runs close callbacks when the client disconnects', async () => {
    const base = await start()
    closedByServer.length = 0
    const controller = new AbortController()
    const response = await fetch(`${base}/events`, { signal: controller.signal })
    const reader = response.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: status')
    expect(openSseStreamCount()).toBe(1)
    controller.abort()
    await new Promise((r) => setTimeout(r, 100))
    expect(closedByServer).toEqual(['closed'])
    expect(openSseStreamCount()).toBe(0)
  })

  it('closeAllSseStreams ends open streams (graceful shutdown)', async () => {
    const base = await start()
    const response = await fetch(`${base}/events`)
    const text = response.text()
    await new Promise((r) => setTimeout(r, 50))
    closeAllSseStreams()
    expect(await text).toContain('event: status')
  })
})
