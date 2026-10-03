/**
 * In-call chat log (pure). The messaging layer already dropped unencrypted packets, unknown or mismatched senders and
 * duplicate ids; this log re-validates bodies with `chatBodySchema`, caps every sender at 20 messages per 10 s
 * (decision), keeps at most 500 messages, orders by arrival and clamps the sender's clock to receive time ± 5 min.
 * While the host turned chat off, incoming messages are dropped (decision; chat is E2EE, so "off" holds only for
 * well-behaved clients).
 */
import { CHAT_MAX_LENGTH, chatBodySchema } from '#shared/schemas/livekit'
import { SlidingWindowLimiter } from '../reactions/limiter'

export interface ChatMessage {
  /** Local id (rendering key). */
  id: string
  /** Sender identity. */
  from: string
  /** Sender name when the message arrived. */
  name: string
  text: string
  /** Display time (epoch ms): the sender's clock clamped to the receive time ± 5 minutes. */
  ts: number
  own: boolean
  status: 'sent' | 'failed'
}

export interface ChatSender {
  identity: string
  name: string
}

export interface ChatLogOptions {
  maxMessages?: number
  perSenderLimit?: number
  perSenderWindowMs?: number
  skewMs?: number
  now?: () => number
}

export type ReceiveResult =
  { accepted: true; message: ChatMessage } | { accepted: false; reason: 'invalid' | 'disabled' | 'rate-limited' }

export type DraftResult = { ok: true; text: string } | { ok: false; error: string }

export const CHAT_LIMITS = {
  maxMessages: 500,
  perSenderLimit: 20,
  perSenderWindowMs: 10_000,
  skewMs: 5 * 60_000,
} as const

/** Checks a draft before sending: not blank, at most 2000 characters (`chatBodySchema`). */
export function validateDraft(draft: string): DraftResult {
  const text = draft.trim()
  if (!text) return { ok: false, error: 'Type a message first.' }
  if (text.length > CHAT_MAX_LENGTH)
    return { ok: false, error: `Messages can have up to ${CHAT_MAX_LENGTH} characters.` }
  const parsed = chatBodySchema.safeParse({ text })
  return parsed.success ? { ok: true, text: parsed.data.text } : { ok: false, error: 'This message cannot be sent.' }
}

export function clampTimestamp(ts: number, receivedAt: number, skewMs: number = CHAT_LIMITS.skewMs): number {
  if (!Number.isFinite(ts)) return receivedAt
  return Math.min(Math.max(ts, receivedAt - skewMs), receivedAt + skewMs)
}

export class ChatLog {
  private list: ChatMessage[] = []
  private unreadCount = 0
  private counter = 0
  private readonly limiter: SlidingWindowLimiter
  private readonly maxMessages: number
  private readonly skewMs: number
  private readonly now: () => number

  constructor(options: ChatLogOptions = {}) {
    this.maxMessages = options.maxMessages ?? CHAT_LIMITS.maxMessages
    this.skewMs = options.skewMs ?? CHAT_LIMITS.skewMs
    this.now = options.now ?? Date.now
    this.limiter = new SlidingWindowLimiter({
      limit: options.perSenderLimit ?? CHAT_LIMITS.perSenderLimit,
      windowMs: options.perSenderWindowMs ?? CHAT_LIMITS.perSenderWindowMs,
    })
  }

  get messages(): readonly ChatMessage[] {
    return this.list
  }

  get unread(): number {
    return this.unreadCount
  }

  /** A remote message from the messaging layer. `panelOpen` decides whether it counts as unread. */
  receive(
    body: unknown,
    from: ChatSender,
    ts: number,
    context: { chatEnabled: boolean; panelOpen: boolean },
  ): ReceiveResult {
    if (!context.chatEnabled) return { accepted: false, reason: 'disabled' }
    const parsed = chatBodySchema.safeParse(body)
    if (!parsed.success) return { accepted: false, reason: 'invalid' }
    const receivedAt = this.now()
    if (!this.limiter.allow(from.identity, receivedAt)) return { accepted: false, reason: 'rate-limited' }
    const message: ChatMessage = {
      id: this.nextId(),
      from: from.identity,
      name: from.name,
      text: parsed.data.text,
      ts: clampTimestamp(ts, receivedAt, this.skewMs),
      own: false,
      status: 'sent',
    }
    this.append(message)
    if (!context.panelOpen) this.unreadCount++
    return { accepted: true, message }
  }

  /** An own message after `send` resolved (LiveKit never echoes it), or after it failed (shown with Retry). */
  addOwn(text: string, from: ChatSender, status: 'sent' | 'failed' = 'sent'): ChatMessage {
    const message: ChatMessage = {
      id: this.nextId(),
      from: from.identity,
      name: from.name,
      text,
      ts: this.now(),
      own: true,
      status,
    }
    this.append(message)
    return message
  }

  remove(id: string): ChatMessage | undefined {
    const index = this.list.findIndex((message) => message.id === id)
    if (index === -1) return undefined
    const [removed] = this.list.splice(index, 1)
    this.list = [...this.list]
    return removed
  }

  markRead(): void {
    this.unreadCount = 0
  }

  private append(message: ChatMessage) {
    const next = [...this.list, message]
    this.list = next.length > this.maxMessages ? next.slice(next.length - this.maxMessages) : next
  }

  private nextId(): string {
    this.counter++
    return `m${this.counter}`
  }
}
