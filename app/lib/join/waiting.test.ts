import { describe, expect, it, vi } from 'vitest'
import type { WaitingEvent } from '#shared/schemas/join'
import { openWaitingStream, parseWaitingEvent, waitingEventsUrl, type EventSourceLike } from './waiting'

const GRANT = {
  token: 'header.payload.signature',
  url: 'wss://meet.example.com',
  epoch: 'AAAAAAAAAAAAAAAAAAAAAA',
  identity: 'p_0123456789abcdef',
  role: 'participant',
  roomId: '0190a1b2-c3d4-7e5f-8a9b-00000000000a',
}

class FakeEventSource implements EventSourceLike {
  readyState = 0
  onerror: ((event: unknown) => void) | null = null
  closed = false
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
  fail(readyState: number) {
    this.readyState = readyState
    this.onerror?.({})
  }
}

function open() {
  let source!: FakeEventSource
  const events: WaitingEvent[] = []
  const onFailure = vi.fn()
  const stream = openWaitingStream('req-1/x', { onEvent: (event) => events.push(event), onFailure }, (url) => {
    source = new FakeEventSource(url)
    return source
  })
  return { source, events, onFailure, stream }
}

describe('parseWaitingEvent', () => {
  it('parses every documented event', () => {
    expect(parseWaitingEvent('status', '{"status":"waiting"}')).toEqual({
      event: 'status',
      data: { status: 'waiting' },
    })
    expect(parseWaitingEvent('admitted', JSON.stringify(GRANT))).toEqual({ event: 'admitted', data: GRANT })
    for (const reason of ['denied', 'removed', 'locked']) {
      expect(parseWaitingEvent('denied', JSON.stringify({ reason }))).toEqual({ event: 'denied', data: { reason } })
    }
    expect(parseWaitingEvent('ended', '{}')).toEqual({ event: 'ended', data: {} })
  })

  it('drops extra fields from the grant and rejects malformed ones', () => {
    expect(parseWaitingEvent('admitted', JSON.stringify({ ...GRANT, extra: 'x' }))).toEqual({
      event: 'admitted',
      data: GRANT,
    })
    for (const bad of [
      { ...GRANT, token: '' },
      { ...GRANT, url: 'javascript:alert(1)' },
      { ...GRANT, epoch: 'short' },
      { ...GRANT, role: 'admin' },
      { ...GRANT, roomId: 7 },
      [],
    ]) {
      expect(parseWaitingEvent('admitted', JSON.stringify(bad))).toBeNull()
    }
    expect(parseWaitingEvent('admitted', '{not json')).toBeNull()
    expect(parseWaitingEvent('unknown', '{}')).toBeNull()
  })

  it('treats an unknown denial reason as a denial', () => {
    expect(parseWaitingEvent('denied', '{"reason":"other"}')).toEqual({ event: 'denied', data: { reason: 'denied' } })
    expect(parseWaitingEvent('denied', '')).toEqual({ event: 'denied', data: { reason: 'denied' } })
  })
})

describe('openWaitingStream', () => {
  it('opens a URL that carries only the request id', () => {
    const { source } = open()
    expect(source.url).toBe('/api/join/requests/req-1%2Fx/events')
    expect(waitingEventsUrl('abc')).toBe('/api/join/requests/abc/events')
  })

  it('keeps the stream open on status events and closes it on a final event', () => {
    const { source, events } = open()
    source.emit('status', '{"status":"waiting"}')
    expect(source.closed).toBe(false)
    source.emit('admitted', JSON.stringify(GRANT))
    expect(source.closed).toBe(true)
    expect(events.map((event) => event.event)).toEqual(['status', 'admitted'])
    // Nothing after the final event (the browser could replay it on a reconnect).
    source.emit('admitted', JSON.stringify(GRANT))
    expect(events).toHaveLength(2)
  })

  it.each(['denied', 'ended'])('closes on %s', (name) => {
    const { source, events } = open()
    source.emit(name, '{}')
    expect(source.closed).toBe(true)
    expect(events).toHaveLength(1)
  })

  it('ignores malformed events', () => {
    const { source, events } = open()
    source.emit('admitted', '{"token":1}')
    expect(events).toHaveLength(0)
    expect(source.closed).toBe(false)
  })

  it('lets the browser reconnect, and reports only a stream it gave up on', () => {
    const { source, onFailure } = open()
    source.fail(0) // CONNECTING: the browser retries by itself
    expect(onFailure).not.toHaveBeenCalled()
    source.fail(2) // CLOSED: an error answer
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(source.closed).toBe(true)
  })

  it('stops delivering after close()', () => {
    const { source, events, stream, onFailure } = open()
    stream.close()
    expect(source.closed).toBe(true)
    source.emit('admitted', JSON.stringify(GRANT))
    source.fail(2)
    expect(events).toHaveLength(0)
    expect(onFailure).not.toHaveBeenCalled()
    stream.close()
  })
})
