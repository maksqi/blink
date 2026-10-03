/**
 * Duplicate-tab detection for `/m/<slug>` (rooms-ui, Stage 04) over `BroadcastChannel('blinq:call:<slug>')`.
 *
 *   new tab ── hello ──────────────► every tab of this meeting in this browser
 *   tab in the call ── here ───────► new tab        (the new tab offers "Use here")
 *   new tab ── leave ──────────────► that tab       ("Use here": the other tab leaves the call)
 *   that tab ── left ──────────────► new tab        (the new tab continues)
 *
 * Only same-origin tabs can post on the channel; messages are still shape-checked and addressed by random tab ids.
 * Without BroadcastChannel (very old browsers) the probe finds nobody. Pure module: the channel is passed in.
 */

export interface ChannelLike {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
  close(): void
}

export type PresenceMessage =
  | { type: 'hello'; from: string }
  | { type: 'here'; from: string; to: string }
  | { type: 'leave'; from: string; to: string }
  | { type: 'left'; from: string; to: string }

interface Waiter {
  match: (message: PresenceMessage) => boolean
  settle: (message: PresenceMessage | null) => void
}

export function presenceChannelName(slug: string): string {
  return `blinq:call:${slug}`
}

const TYPES = new Set(['hello', 'here', 'leave', 'left'])

export function parsePresenceMessage(value: unknown): PresenceMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const { type, from, to } = value as Record<string, unknown>
  if (typeof type !== 'string' || !TYPES.has(type) || typeof from !== 'string' || from.length === 0) return null
  if (type === 'hello') return { type, from }
  if (typeof to !== 'string' || to.length === 0) return null
  return { type, from, to } as PresenceMessage
}

export interface TabPresenceOptions {
  /** Null when BroadcastChannel is unavailable. */
  channel: ChannelLike | null
  /** This tab's random id. */
  id: string
  /** True while this tab is in the call (it then answers `hello`). */
  inCall: () => boolean
  /** Another tab took the meeting over: leave the call. */
  onLeaveRequest: () => Promise<void> | void
}

export class TabPresence {
  private readonly channel: ChannelLike | null
  private readonly id: string
  private readonly options: TabPresenceOptions
  private readonly waiters = new Set<Waiter>()
  private closed = false

  constructor(options: TabPresenceOptions) {
    this.options = options
    this.channel = options.channel
    this.id = options.id
    if (this.channel) this.channel.onmessage = (event) => void this.receive(event.data)
  }

  /** Asks the other tabs of this meeting whether one of them is in the call; resolves with its id or null. */
  probe(timeoutMs: number): Promise<string | null> {
    return this.expect((message) => message.type === 'here', { type: 'hello', from: this.id }, timeoutMs).then(
      (message) => message?.from ?? null,
    )
  }

  /** Asks tab `target` to leave the call; resolves true once it confirms (false after the timeout). */
  async requestLeave(target: string, timeoutMs: number): Promise<boolean> {
    const message: PresenceMessage = { type: 'leave', from: this.id, to: target }
    const answer = await this.expect((m) => m.type === 'left' && m.from === target, message, timeoutMs)
    return answer !== null
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of [...this.waiters]) waiter.settle(null)
    if (this.channel) {
      this.channel.onmessage = null
      try {
        this.channel.close()
      } catch {
        // Already closed.
      }
    }
  }

  private post(message: PresenceMessage) {
    if (this.closed || !this.channel) return
    try {
      this.channel.postMessage(message)
    } catch {
      // A closed channel cannot post; nobody is listening then.
    }
  }

  private expect(
    match: (message: PresenceMessage) => boolean,
    send: PresenceMessage,
    timeoutMs: number,
  ): Promise<PresenceMessage | null> {
    if (this.closed || !this.channel) return Promise.resolve(null)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        match,
        settle: (message) => {
          clearTimeout(timer)
          this.waiters.delete(waiter)
          resolve(message)
        },
      }
      const timer = setTimeout(() => waiter.settle(null), timeoutMs)
      this.waiters.add(waiter)
      this.post(send)
    })
  }

  private async receive(data: unknown) {
    if (this.closed) return
    const message = parsePresenceMessage(data)
    if (!message || message.from === this.id) return
    if (message.type !== 'hello' && message.to !== this.id) return
    if (message.type === 'hello') {
      if (this.options.inCall()) this.post({ type: 'here', from: this.id, to: message.from })
      return
    }
    if (message.type === 'leave') {
      try {
        await this.options.onLeaveRequest()
      } finally {
        this.post({ type: 'left', from: this.id, to: message.from })
      }
      return
    }
    for (const waiter of [...this.waiters]) if (waiter.match(message)) waiter.settle(message)
  }
}
