/**
 * BLQ1: the at-rest format of every recording file (docs/SECURITY.md §6, Stage 08). A Tink-style streaming AEAD:
 *
 *   header (49 B) = "BLQ1" | version u8 = 1 | keyId u8 = 1 | segSize u32be | salt (32) | noncePrefix (7)
 *   key           = HKDF-SHA256(ikm = RECORDING_ENCRYPTION_KEY bytes, salt, info, 32 B)
 *   segment i     = AES-256-GCM(plaintext_i) ‖ tag (16), IV = noncePrefix ‖ u32be(i) ‖ lastFlag (u8), AAD = header
 *
 * Full segments are never final; every stream ends with a final segment of `size mod segSize` bytes (possibly empty),
 * so the plaintext size follows from the file size, and truncation, reordering and tampering all fail
 * authentication. `info` binds a file to its place: `"blinq/v1/rec|" + recordingId` for the final recording and
 * `... + "|chunk|" + seq` for uploaded chunks, so a chunk cannot move to another position or recording.
 * Plaintext is only ever released after `decipher.final()` succeeded for its segment.
 *
 * - `createEncryptStream(options)` / `createDecryptStream(options)`: streaming Transforms (constant memory).
 * - `encryptBuffer` / `decryptBuffer`: whole-buffer helpers (tests, small data).
 * - `openBlq1File(path, options)`: random-access reader (Range requests, chunk decryption) that decrypts only the
 *   segments it is asked for.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { open, type FileHandle } from 'node:fs/promises'
import { Transform } from 'node:stream'

export const BLQ1_MAGIC = Buffer.from('BLQ1', 'ascii')
export const BLQ1_VERSION = 1
export const BLQ1_KEY_ID = 1
export const BLQ1_HEADER_SIZE = 49
export const BLQ1_TAG_SIZE = 16
export const BLQ1_SALT_SIZE = 32
export const BLQ1_NONCE_PREFIX_SIZE = 7
/** Production segment size. */
export const BLQ1_SEGMENT_SIZE = 1024 * 1024
/** The reader accepts 64 B … 16 MiB, so tests can use tiny segments. */
export const BLQ1_MIN_SEGMENT_SIZE = 64
export const BLQ1_MAX_SEGMENT_SIZE = 16 * 1024 * 1024
const MAX_SEGMENTS = 0xffffffff

export type Blq1Failure = 'header' | 'version' | 'key_id' | 'segment_size' | 'truncated' | 'authentication'

/** Integrity or format failure. Never carries key material or plaintext. */
export class Blq1Error extends Error {
  constructor(readonly reason: Blq1Failure) {
    super(`BLQ1 ${reason} failure`)
    this.name = 'Blq1Error'
  }
}

export interface Blq1Header {
  version: number
  keyId: number
  segmentSize: number
  salt: Buffer
  noncePrefix: Buffer
  /** The exact 49 header bytes (the AAD of every segment). */
  bytes: Buffer
}

export interface Blq1KeyOptions {
  /** RECORDING_ENCRYPTION_KEY as raw bytes (32). */
  masterKey: Uint8Array
  /** `recordingInfo(id)` or `chunkInfo(id, seq)`. */
  info: string
}

export interface Blq1EncryptOptions extends Blq1KeyOptions {
  segmentSize?: number
  keyId?: number
}

export function recordingInfo(recordingId: string): string {
  return `blinq/v1/rec|${recordingId}`
}

export function chunkInfo(recordingId: string, seq: number): string {
  return `${recordingInfo(recordingId)}|chunk|${seq}`
}

export function deriveFileKey(masterKey: Uint8Array, salt: Uint8Array, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, info, 32))
}

export function encodeHeader(input: {
  segmentSize: number
  salt: Uint8Array
  noncePrefix: Uint8Array
  keyId?: number
}): Buffer {
  assertSegmentSize(input.segmentSize)
  if (input.salt.length !== BLQ1_SALT_SIZE || input.noncePrefix.length !== BLQ1_NONCE_PREFIX_SIZE) {
    throw new RangeError('Invalid BLQ1 salt or nonce prefix length')
  }
  const header = Buffer.alloc(BLQ1_HEADER_SIZE)
  BLQ1_MAGIC.copy(header, 0)
  header.writeUInt8(BLQ1_VERSION, 4)
  header.writeUInt8(input.keyId ?? BLQ1_KEY_ID, 5)
  header.writeUInt32BE(input.segmentSize, 6)
  Buffer.from(input.salt).copy(header, 10)
  Buffer.from(input.noncePrefix).copy(header, 10 + BLQ1_SALT_SIZE)
  return header
}

/** Bounds-checked header parser. */
export function parseHeader(bytes: Uint8Array): Blq1Header {
  if (bytes.length < BLQ1_HEADER_SIZE) throw new Blq1Error('truncated')
  const header = Buffer.from(bytes.subarray(0, BLQ1_HEADER_SIZE))
  if (!header.subarray(0, 4).equals(BLQ1_MAGIC)) throw new Blq1Error('header')
  const version = header.readUInt8(4)
  if (version !== BLQ1_VERSION) throw new Blq1Error('version')
  const keyId = header.readUInt8(5)
  if (keyId !== BLQ1_KEY_ID) throw new Blq1Error('key_id')
  const segmentSize = header.readUInt32BE(6)
  if (segmentSize < BLQ1_MIN_SEGMENT_SIZE || segmentSize > BLQ1_MAX_SEGMENT_SIZE) throw new Blq1Error('segment_size')
  return {
    version,
    keyId,
    segmentSize,
    salt: header.subarray(10, 10 + BLQ1_SALT_SIZE),
    noncePrefix: header.subarray(10 + BLQ1_SALT_SIZE, BLQ1_HEADER_SIZE),
    bytes: header,
  }
}

function assertSegmentSize(size: number) {
  if (!Number.isInteger(size) || size < BLQ1_MIN_SEGMENT_SIZE || size > BLQ1_MAX_SEGMENT_SIZE) {
    throw new RangeError(`BLQ1 segment size must be ${BLQ1_MIN_SEGMENT_SIZE}..${BLQ1_MAX_SEGMENT_SIZE}`)
  }
}

export function segmentIv(noncePrefix: Uint8Array, index: number, last: boolean): Buffer {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SEGMENTS) throw new RangeError('BLQ1 segment index out of range')
  const iv = Buffer.alloc(12)
  Buffer.from(noncePrefix).copy(iv, 0)
  iv.writeUInt32BE(index, BLQ1_NONCE_PREFIX_SIZE)
  iv.writeUInt8(last ? 1 : 0, 11)
  return iv
}

function sealSegment(key: Buffer, header: Blq1Header, index: number, last: boolean, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, segmentIv(header.noncePrefix, index, last), { authTagLength: BLQ1_TAG_SIZE })
  cipher.setAAD(header.bytes)
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

function openSegment(key: Buffer, header: Blq1Header, index: number, last: boolean, sealed: Buffer): Buffer {
  if (sealed.length < BLQ1_TAG_SIZE) throw new Blq1Error('truncated')
  const decipher = createDecipheriv('aes-256-gcm', key, segmentIv(header.noncePrefix, index, last), {
    authTagLength: BLQ1_TAG_SIZE,
  })
  decipher.setAAD(header.bytes)
  decipher.setAuthTag(sealed.subarray(sealed.length - BLQ1_TAG_SIZE))
  const body = decipher.update(sealed.subarray(0, sealed.length - BLQ1_TAG_SIZE))
  try {
    // update() output is unauthenticated: it is released only once final() has verified the tag.
    return Buffer.concat([body, decipher.final()])
  } catch {
    throw new Blq1Error('authentication')
  }
}

// ---- Size math ------------------------------------------------------------------------------------------------------

/** On-disk size of a BLQ1 file holding `plaintextSize` bytes. */
export function encryptedSize(plaintextSize: number, segmentSize = BLQ1_SEGMENT_SIZE): number {
  const segments = Math.floor(plaintextSize / segmentSize) + 1
  return BLQ1_HEADER_SIZE + plaintextSize + segments * BLQ1_TAG_SIZE
}

export interface Blq1Layout {
  /** Number of full (non-final) segments; the final segment has index `fullSegments`. */
  fullSegments: number
  /** Plaintext bytes in the final segment (0 ≤ n < segmentSize). */
  finalSize: number
  plaintextSize: number
  segmentCount: number
}

/** Layout implied by a file size; throws `truncated` when no valid BLQ1 file has this size. */
export function layoutForFileSize(fileSize: number, segmentSize: number): Blq1Layout {
  const body = fileSize - BLQ1_HEADER_SIZE - BLQ1_TAG_SIZE
  if (!Number.isSafeInteger(body) || body < 0) throw new Blq1Error('truncated')
  const fullSegments = Math.floor(body / (segmentSize + BLQ1_TAG_SIZE))
  const finalSize = body - fullSegments * (segmentSize + BLQ1_TAG_SIZE)
  if (finalSize >= segmentSize || fullSegments >= MAX_SEGMENTS) throw new Blq1Error('truncated')
  return {
    fullSegments,
    finalSize,
    plaintextSize: fullSegments * segmentSize + finalSize,
    segmentCount: fullSegments + 1,
  }
}

// ---- Buffer helpers -------------------------------------------------------------------------------------------------

function newHeader(options: Blq1EncryptOptions): { header: Blq1Header; key: Buffer } {
  const segmentSize = options.segmentSize ?? BLQ1_SEGMENT_SIZE
  const salt = randomBytes(BLQ1_SALT_SIZE)
  const bytes = encodeHeader({ segmentSize, salt, noncePrefix: randomBytes(BLQ1_NONCE_PREFIX_SIZE), keyId: options.keyId })
  const header = parseHeader(bytes)
  return { header, key: deriveFileKey(options.masterKey, header.salt, options.info) }
}

export function encryptBuffer(plaintext: Uint8Array, options: Blq1EncryptOptions): Buffer {
  const { header, key } = newHeader(options)
  const data = Buffer.from(plaintext)
  const size = header.segmentSize
  const parts: Buffer[] = [header.bytes]
  const full = Math.floor(data.length / size)
  for (let i = 0; i < full; i++) parts.push(sealSegment(key, header, i, false, data.subarray(i * size, (i + 1) * size)))
  parts.push(sealSegment(key, header, full, true, data.subarray(full * size)))
  return Buffer.concat(parts)
}

export function decryptBuffer(file: Uint8Array, options: Blq1KeyOptions): Buffer {
  const data = Buffer.from(file)
  const header = parseHeader(data)
  const layout = layoutForFileSize(data.length, header.segmentSize)
  const key = deriveFileKey(options.masterKey, header.salt, options.info)
  const stride = header.segmentSize + BLQ1_TAG_SIZE
  const parts: Buffer[] = []
  for (let i = 0; i < layout.segmentCount; i++) {
    const start = BLQ1_HEADER_SIZE + i * stride
    const last = i === layout.fullSegments
    const end = last ? data.length : start + stride
    parts.push(openSegment(key, header, i, last, data.subarray(start, end)))
  }
  return Buffer.concat(parts)
}

// ---- Streams --------------------------------------------------------------------------------------------------------

/** FIFO of buffers with cheap "take the first n bytes". */
class ByteQueue {
  private parts: Buffer[] = []
  length = 0

  push(chunk: Buffer) {
    if (chunk.length === 0) return
    this.parts.push(chunk)
    this.length += chunk.length
  }

  take(n: number): Buffer {
    if (n > this.length) throw new RangeError('ByteQueue underflow')
    const out = Buffer.allocUnsafe(n)
    let offset = 0
    while (offset < n) {
      const head = this.parts[0]!
      const need = n - offset
      if (head.length <= need) {
        head.copy(out, offset)
        offset += head.length
        this.parts.shift()
      } else {
        head.copy(out, offset, 0, need)
        this.parts[0] = head.subarray(need)
        offset += need
      }
    }
    this.length -= n
    return out
  }
}

/** Encrypts a plaintext stream into BLQ1 (header first, then segments). */
export function createEncryptStream(options: Blq1EncryptOptions): Transform {
  const { header, key } = newHeader(options)
  const size = header.segmentSize
  const queue = new ByteQueue()
  let index = 0
  let started = false
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        if (!started) {
          this.push(header.bytes)
          started = true
        }
        queue.push(chunk)
        // A full segment is never final, so it can be sealed as soon as it is complete.
        while (queue.length >= size) this.push(sealSegment(key, header, index++, false, queue.take(size)))
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
    flush(callback) {
      try {
        if (!started) this.push(header.bytes)
        this.push(sealSegment(key, header, index, true, queue.take(queue.length)))
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
  })
}

/** Decrypts a BLQ1 stream; errors with `Blq1Error` on any format, truncation or authentication failure. */
export function createDecryptStream(options: Blq1KeyOptions): Transform {
  const queue = new ByteQueue()
  let header: Blq1Header | undefined
  let key: Buffer | undefined
  let index = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        queue.push(chunk)
        if (!header) {
          if (queue.length < BLQ1_HEADER_SIZE) return callback()
          header = parseHeader(queue.take(BLQ1_HEADER_SIZE))
          key = deriveFileKey(options.masterKey, header.salt, options.info)
        }
        const stride = header.segmentSize + BLQ1_TAG_SIZE
        // Only a segment followed by more bytes is known to be non-final.
        while (queue.length > stride) this.push(openSegment(key!, header, index++, false, queue.take(stride)))
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
    flush(callback) {
      try {
        if (!header) throw new Blq1Error('truncated')
        const stride = header.segmentSize + BLQ1_TAG_SIZE
        if (queue.length < BLQ1_TAG_SIZE || queue.length >= stride) throw new Blq1Error('truncated')
        this.push(openSegment(key!, header, index, true, queue.take(queue.length)))
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
  })
}

// ---- Random access --------------------------------------------------------------------------------------------------

export interface Blq1Reader {
  readonly plaintextSize: number
  readonly segmentSize: number
  readonly segmentCount: number
  /** Decrypts one whole segment. */
  readSegment(index: number): Promise<Buffer>
  /** Decrypts the final segment, which proves the file was not truncated. */
  verifyFinal(): Promise<void>
  /** Plaintext bytes `start..end` (inclusive), segment by segment; decrypts only the covering segments. */
  range(start: number, end: number): AsyncGenerator<Buffer>
  /** Every plaintext segment in order. */
  segments(): AsyncGenerator<Buffer>
  close(): Promise<void>
}

async function readExactly(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Blq1Error('truncated')
    offset += bytesRead
  }
  return buffer
}

export async function openBlq1File(path: string, options: Blq1KeyOptions): Promise<Blq1Reader> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size < BLQ1_HEADER_SIZE) throw new Blq1Error('truncated')
    const header = parseHeader(await readExactly(handle, BLQ1_HEADER_SIZE, 0))
    const layout = layoutForFileSize(size, header.segmentSize)
    const key = deriveFileKey(options.masterKey, header.salt, options.info)
    const stride = header.segmentSize + BLQ1_TAG_SIZE

    const readSegment = async (index: number): Promise<Buffer> => {
      if (!Number.isInteger(index) || index < 0 || index >= layout.segmentCount) throw new RangeError('segment index')
      const last = index === layout.fullSegments
      const length = last ? layout.finalSize + BLQ1_TAG_SIZE : stride
      const sealed = await readExactly(handle, length, BLQ1_HEADER_SIZE + index * stride)
      return openSegment(key, header, index, last, sealed)
    }

    return {
      plaintextSize: layout.plaintextSize,
      segmentSize: header.segmentSize,
      segmentCount: layout.segmentCount,
      readSegment,
      async verifyFinal() {
        await readSegment(layout.fullSegments)
      },
      async *range(start: number, end: number) {
        if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end < layout.plaintextSize)) {
          throw new RangeError('BLQ1 range out of bounds')
        }
        const first = Math.floor(start / header.segmentSize)
        const lastIndex = Math.floor(end / header.segmentSize)
        for (let i = first; i <= lastIndex; i++) {
          const plain = await readSegment(i)
          const base = i * header.segmentSize
          yield plain.subarray(Math.max(0, start - base), Math.min(plain.length, end - base + 1))
        }
      },
      async *segments() {
        for (let i = 0; i < layout.segmentCount; i++) yield await readSegment(i)
      },
      close: () => handle.close(),
    }
  } catch (error) {
    await handle.close()
    throw error
  }
}
