/**
 * Encrypted app messages (`AppMessaging`) over LiveKit reliable data. docs/SECURITY.md §3.3, docs/API.md §12.
 *
 * Send: the app envelope (AES-256-GCM with the per-meeting chat key, AAD bound to slug and sender) on
 * `blinq.chat.v1` / `blinq.reaction.v1`; `to` becomes `destinationIdentities`.
 *
 * Receive drops a packet when
 * - LiveKit reports `encryptionType` NONE (the data channel itself was not encrypted),
 * - the sender is unknown (no participant, or one this client does not know),
 * - the envelope does not open (wrong key, tampering, or envelope sender ≠ LiveKit sender),
 * - the envelope type does not match the topic,
 * - the envelope's sender timestamp is more than 5 minutes away from this device's clock (a replay after a reload or
 *   after the id memory overflowed; the margin allows for clock skew between devices), or
 * - the message id was seen before (replay).
 *
 * `blinq.srv.v1` is accepted only without a sender participant, parsed with `serverHintSchema` and emitted as a
 * `server.hint` event: a hint to refetch from the API, never authority. No RPC methods are registered anywhere.
 */
import { Encryption_Type } from 'livekit-client'
import { DATA_TOPICS, serverHintSchema } from '#shared/schemas/livekit'
import type { AppMessaging, CallEventBus, ParticipantView } from '../contracts/call'
import { openAppMessage, sealAppMessage, type AppMessage, type AppMessageType } from '../e2ee/envelope'

export const TOPIC_BY_TYPE: Record<AppMessageType, string> = {
  chat: DATA_TOPICS.chat,
  reaction: DATA_TOPICS.reaction,
}

const TYPE_BY_TOPIC = new Map<string, AppMessageType>(
  (Object.entries(TOPIC_BY_TYPE) as [AppMessageType, string][]).map(([type, topic]) => [topic, type]),
)

/** Server hints are tiny JSON objects; anything bigger is not a hint. */
const MAX_HINT_BYTES = 1024

/**
 * How far an envelope's timestamp (the sender's clock, authenticated by the envelope) may be from this device's clock,
 * either way. Delivery takes milliseconds; the margin is for devices whose clocks disagree (decision).
 */
export const MESSAGE_FRESHNESS_MS = 5 * 60_000

export type DropReason =
  | 'unencrypted'
  | 'unknown-sender'
  | 'no-key'
  | 'envelope'
  | 'type-mismatch'
  | 'stale'
  | 'duplicate'
  | 'hint-from-participant'
  | 'hint-invalid'

export interface IncomingPacket {
  payload: Uint8Array
  /** LiveKit identity of the sending participant; undefined when LiveKit reports no participant. */
  senderIdentity: string | undefined
  topic: string | undefined
  /** LiveKit `Encryption_Type` of the packet. */
  encryptionType: Encryption_Type | undefined
}

export interface MessagingTransport {
  localIdentity(): string | null
  publish(bytes: Uint8Array<ArrayBuffer>, options: { topic: string; destinationIdentities?: string[] }): Promise<void>
}

export interface MessagingOptions {
  slug: string
  /** The per-meeting chat key once derived (null before joining). */
  chatKey: () => CryptoKey | null
  transport: MessagingTransport
  /** The view of a known remote participant, or null. */
  lookup: (identity: string) => ParticipantView | null
  events: CallEventBus
  now?: () => number
  /** Remembered message ids for duplicate detection. */
  seenLimit?: number
  /** Diagnostics for dropped packets (tests, debug logging). Never receives plaintext. */
  onDrop?: (reason: DropReason, packet: IncomingPacket) => void
  onHandlerError?: (error: unknown) => void
}

export interface CallMessaging extends AppMessaging {
  handlePacket(packet: IncomingPacket): Promise<void>
  dispose(): void
}

type MessageHandler = (body: unknown, from: ParticipantView, ts: number) => void

class SeenIds {
  private readonly ids = new Set<string>()
  constructor(private readonly limit: number) {}

  /** Returns false when the id was already seen. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value
      if (oldest !== undefined) this.ids.delete(oldest)
    }
    return true
  }
}

export function createMessaging(options: MessagingOptions): CallMessaging {
  const handlers = new Map<AppMessageType, Set<MessageHandler>>()
  const seen = new SeenIds(options.seenLimit ?? 5000)
  const now = options.now ?? Date.now
  const drop = (reason: DropReason, packet: IncomingPacket) => options.onDrop?.(reason, packet)
  const reportHandlerError = options.onHandlerError ?? ((error: unknown) => console.error(error))
  let disposed = false

  function handleServerHint(packet: IncomingPacket) {
    // Anyone holding a participant slot could send on this topic; only packets without a sender can be the server.
    if (packet.senderIdentity) return drop('hint-from-participant', packet)
    if (packet.payload.byteLength > MAX_HINT_BYTES) return drop('hint-invalid', packet)
    let data: unknown
    try {
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packet.payload))
    } catch {
      return drop('hint-invalid', packet)
    }
    const hint = serverHintSchema.safeParse(data)
    if (!hint.success) return drop('hint-invalid', packet)
    options.events.emit('server.hint', { type: hint.data.type })
  }

  async function handlePacket(packet: IncomingPacket): Promise<void> {
    if (disposed || !packet.topic) return
    if (packet.topic === DATA_TOPICS.server) return handleServerHint(packet)
    const type = TYPE_BY_TOPIC.get(packet.topic)
    if (!type) return // not a blinq app topic

    if (packet.encryptionType === undefined || packet.encryptionType === Encryption_Type.NONE) {
      return drop('unencrypted', packet)
    }
    if (!packet.senderIdentity) return drop('unknown-sender', packet)
    const sender = options.lookup(packet.senderIdentity)
    if (!sender || sender.isLocal) return drop('unknown-sender', packet)
    const key = options.chatKey()
    if (!key) return drop('no-key', packet)

    let message: AppMessage
    try {
      message = await openAppMessage(key, options.slug, packet.senderIdentity, packet.payload)
    } catch {
      return drop('envelope', packet)
    }
    if (message.type !== type) return drop('type-mismatch', packet)
    // The id memory is per page and bounded, so an old envelope replayed after a reload would look new (F-031).
    if (Math.abs(now() - message.ts) > MESSAGE_FRESHNESS_MS) return drop('stale', packet)
    if (!seen.add(message.id)) return drop('duplicate', packet)
    if (disposed) return

    // Re-read the sender: the view may have changed while decrypting.
    const from = options.lookup(packet.senderIdentity) ?? sender
    for (const handler of [...(handlers.get(type) ?? [])]) {
      try {
        handler(message.body, from, message.ts)
      } catch (error) {
        reportHandlerError(error)
      }
    }
  }

  return {
    async send(type, body, sendOptions) {
      const key = options.chatKey()
      const from = options.transport.localIdentity()
      if (disposed || !key || !from) throw new Error('Not connected to the call')
      const message: AppMessage = { id: crypto.randomUUID(), type, from, ts: now(), body }
      const bytes = await sealAppMessage(key, options.slug, message)
      seen.add(message.id)
      await options.transport.publish(bytes, {
        topic: TOPIC_BY_TYPE[type],
        ...(sendOptions?.to?.length ? { destinationIdentities: [...sendOptions.to] } : {}),
      })
    },
    on(type, handler) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    },
    handlePacket,
    dispose() {
      disposed = true
      handlers.clear()
    },
  }
}
