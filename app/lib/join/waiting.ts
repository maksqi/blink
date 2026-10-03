/**
 * The waiting-room event stream (`GET /api/join/requests/:id/events`, docs/API.md §6.1) over `EventSource`.
 *
 * - The URL carries only the request id; the session or guest cookie authorizes it (never a secret in the URL).
 * - The first event is the current state. `admitted`, `denied` and `ended` are final: the server closes the stream
 *   after them, so the client closes its `EventSource` right away, or the browser would reconnect and get the final
 *   event again.
 * - While the connection drops and comes back the browser reconnects by itself; only a stream the browser gave up on
 *   (an error answer such as 403) is reported as a failure.
 * - Event data is validated before use; anything malformed is ignored.
 */
import type { JoinGrant, WaitingEvent } from '#shared/schemas/join'

type GrantData = Omit<JoinGrant, 'status'>

/** The parts of `EventSource` this module uses (so tests can pass a fake). */
export interface EventSourceLike {
  readonly readyState: number
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void
  onerror: ((event: unknown) => void) | null
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

export interface WaitingHandlers {
  onEvent(event: WaitingEvent): void
  /** The browser gave up on the stream (an error answer); the request may still exist. */
  onFailure(): void
}

export interface WaitingStream {
  close(): void
}

/** `EventSource.CLOSED`. */
const CLOSED = 2
const ROLES = new Set(['host', 'cohost', 'participant'])
type DeniedReason = 'denied' | 'removed' | 'locked'
const DENIED_REASONS: ReadonlySet<string> = new Set<DeniedReason>(['denied', 'removed', 'locked'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGrantData(value: unknown): value is GrantData {
  if (!isRecord(value)) return false
  const { token, url, epoch, identity, role, roomId } = value
  return (
    typeof token === 'string' &&
    token.length > 0 &&
    typeof url === 'string' &&
    /^(?:wss?|https?):\/\//.test(url) &&
    typeof epoch === 'string' &&
    /^[A-Za-z0-9_-]{22}$/.test(epoch) &&
    typeof identity === 'string' &&
    identity.length > 0 &&
    typeof role === 'string' &&
    ROLES.has(role) &&
    typeof roomId === 'string' &&
    roomId.length > 0
  )
}

/** Parses one named SSE event; null for unknown names or malformed data. */
export function parseWaitingEvent(name: string, raw: unknown): WaitingEvent | null {
  let data: unknown
  try {
    data = typeof raw === 'string' && raw.length > 0 ? JSON.parse(raw) : {}
  } catch {
    return null
  }
  switch (name) {
    case 'status':
      return { event: 'status', data: { status: 'waiting' } }
    case 'admitted':
      if (!isGrantData(data)) return null
      return {
        event: 'admitted',
        data: {
          token: data.token,
          url: data.url,
          epoch: data.epoch,
          identity: data.identity,
          role: data.role,
          roomId: data.roomId,
        },
      }
    case 'denied': {
      const reason = isRecord(data) ? data.reason : undefined
      // An unknown reason is still a denial.
      const known = typeof reason === 'string' && DENIED_REASONS.has(reason)
      return { event: 'denied', data: { reason: known ? (reason as DeniedReason) : 'denied' } }
    }
    case 'ended':
      return { event: 'ended', data: {} }
    default:
      return null
  }
}

export function waitingEventsUrl(requestId: string): string {
  return `/api/join/requests/${encodeURIComponent(requestId)}/events`
}

export function openWaitingStream(
  requestId: string,
  handlers: WaitingHandlers,
  factory: EventSourceFactory = (url) => new EventSource(url) as unknown as EventSourceLike,
): WaitingStream {
  const source = factory(waitingEventsUrl(requestId))
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    source.close()
  }

  for (const name of ['status', 'admitted', 'denied', 'ended']) {
    source.addEventListener(name, (message) => {
      if (closed) return
      const event = parseWaitingEvent(name, message.data)
      if (!event) return
      if (event.event !== 'status') close()
      handlers.onEvent(event)
    })
  }
  source.onerror = () => {
    if (closed || source.readyState !== CLOSED) return
    close()
    handlers.onFailure()
  }
  return { close }
}
