/**
 * App-message envelope (chat, reactions) — encrypted with the per-meeting chat key, sent inside LiveKit's
 * (also encrypted) reliable data channel. Format and rules: docs/API.md and docs/SECURITY.md §3.3.
 *
 *   bytes = 0x01 | iv (12) | AES-256-GCM ciphertext + tag (16)
 *   AAD   = "blinq/app/v1|" + slug + "|" + senderIdentity
 */
import { concatBytes, fromUtf8, randomBytes, utf8 } from './encoding'

export const ENVELOPE_VERSION = 0x01
export const MAX_PLAINTEXT_BYTES = 15 * 1024

export type AppMessageType = 'chat' | 'reaction'

export interface AppMessage<TBody = unknown> {
  /** Unique id (crypto.randomUUID()); receivers drop duplicates. */
  id: string
  type: AppMessageType
  /** Sender LiveKit identity; must equal the identity LiveKit reports for the packet. */
  from: string
  /** Sender clock, epoch ms. */
  ts: number
  body: TBody
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvelopeError'
  }
}

function aad(slug: string, senderIdentity: string) {
  return utf8(`blinq/app/v1|${slug}|${senderIdentity}`)
}

export async function sealAppMessage(
  chatKey: CryptoKey,
  slug: string,
  message: AppMessage,
): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = utf8(JSON.stringify(message))
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new EnvelopeError('Message too large')
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(slug, message.from), tagLength: 128 },
    chatKey,
    plaintext,
  )
  return concatBytes(Uint8Array.of(ENVELOPE_VERSION), iv, new Uint8Array(ciphertext))
}

/**
 * Decrypts and validates an envelope. `senderIdentity` must be the identity LiveKit reported for the packet;
 * a mismatch with the AAD or with `message.from` is rejected.
 */
export async function openAppMessage(
  chatKey: CryptoKey,
  slug: string,
  senderIdentity: string,
  bytes: Uint8Array,
): Promise<AppMessage> {
  if (bytes.length < 1 + 12 + 16 || bytes[0] !== ENVELOPE_VERSION) throw new EnvelopeError('Unsupported envelope')
  const iv = bytes.slice(1, 13)
  const ciphertext = bytes.slice(13)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(slug, senderIdentity), tagLength: 128 },
      chatKey,
      ciphertext,
    )
  } catch {
    throw new EnvelopeError('Decryption failed')
  }
  let message: unknown
  try {
    message = JSON.parse(fromUtf8(new Uint8Array(plaintext)))
  } catch {
    throw new EnvelopeError('Malformed message')
  }
  if (!isAppMessage(message) || message.from !== senderIdentity) throw new EnvelopeError('Invalid message')
  return message
}

function isAppMessage(value: unknown): value is AppMessage {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    m.id.length <= 64 &&
    (m.type === 'chat' || m.type === 'reaction') &&
    typeof m.from === 'string' &&
    typeof m.ts === 'number' &&
    Number.isFinite(m.ts) &&
    'body' in m
  )
}
