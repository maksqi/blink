/**
 * Minimal EventSource-like reader for `GET /api/join/requests/:id/events` in API tests: sends the client's cookies and
 * IP, parses `event:`/`data:` blocks and `: comment` lines, and reports when the server closes the stream.
 */
import type { ApiClient } from '../_harness'

export type SseMessage =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'event'; event: string; data: any; at: number }
  | { kind: 'comment'; text: string; at: number }
  | { kind: 'closed'; at: number }

export interface SseStream {
  /** The next message (event, comment, or the end of the stream); rejects after `timeoutMs`. */
  next(timeoutMs?: number): Promise<SseMessage>
  /** The next event, skipping comments; `closed` if the stream ended first. */
  nextEvent(timeoutMs?: number): Promise<Extract<SseMessage, { kind: 'event' | 'closed' }>>
  close(): void
  readonly contentType: string | null
}

export interface OpenedSse {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any
  stream?: SseStream
}

export async function openSse(api: ApiClient, requestId: string, options: { withCookies?: boolean } = {}): Promise<OpenedSse> {
  const controller = new AbortController()
  const headers: Record<string, string> = { accept: 'text/event-stream', 'x-forwarded-for': api.ip }
  const cookie = api.cookieHeader()
  if (cookie && options.withCookies !== false) headers.cookie = cookie
  const res = await fetch(new URL(`/api/join/requests/${requestId}/events`, api.baseUrl), { headers, signal: controller.signal })
  const contentType = res.headers.get('content-type')
  if (res.status !== 200 || !contentType?.includes('text/event-stream')) {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined }
  }

  const queue: SseMessage[] = []
  const waiters: Array<() => void> = []
  const push = (message: SseMessage) => {
    queue.push(message)
    for (const wake of waiters.splice(0)) wake()
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          let event: string | undefined
          let data: string | undefined
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) push({ kind: 'comment', text: line.slice(1).trim(), at: Date.now() })
            else if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data = line.slice(5).trim()
          }
          if (event !== undefined) push({ kind: 'event', event, data: data ? JSON.parse(data) : undefined, at: Date.now() })
        }
      }
    } catch {
      // Aborted by close().
    }
    push({ kind: 'closed', at: Date.now() })
  })()

  const next = async (timeoutMs = 5_000): Promise<SseMessage> => {
    const deadline = Date.now() + timeoutMs
    while (queue.length === 0) {
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('no SSE message in time')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    return queue.shift()!
  }

  const stream: SseStream = {
    next,
    async nextEvent(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const message = await next(Math.max(1, deadline - Date.now()))
        if (message.kind !== 'comment') return message
      }
    },
    close() {
      controller.abort()
    },
    contentType,
  }
  return { status: 200, stream }
}
