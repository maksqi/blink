import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BLQ1_HEADER_SIZE,
  BLQ1_SEGMENT_SIZE,
  BLQ1_TAG_SIZE,
  Blq1Error,
  chunkInfo,
  createDecryptStream,
  createEncryptStream,
  decryptBuffer,
  encodeHeader,
  encryptBuffer,
  encryptedSize,
  layoutForFileSize,
  openBlq1File,
  parseHeader,
  recordingInfo,
} from './blq1'

const masterKey = randomBytes(32)
const ID = '0199a3b4-0000-7000-8000-000000000001'
const info = recordingInfo(ID)
const SEG = 64
const dir = mkdtempSync(join(tmpdir(), 'blq1-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const opts = (overrides: Partial<{ info: string; segmentSize: number; masterKey: Uint8Array }> = {}) => ({
  masterKey,
  info,
  segmentSize: SEG,
  ...overrides,
})

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(part as Buffer)
  return Buffer.concat(parts)
}

/** Feeds `data` in pieces of `step` bytes through a transform and returns its output. */
async function throughStream(data: Buffer, transform: NodeJS.ReadWriteStream, step = 7): Promise<Buffer> {
  const pieces: Buffer[] = []
  for (let i = 0; i < data.length; i += step) pieces.push(data.subarray(i, i + step))
  const out: Buffer[] = []
  await pipeline(Readable.from(pieces), transform, async (source: AsyncIterable<Buffer | string>) => {
    for await (const part of source) out.push(Buffer.from(part))
  })
  return Buffer.concat(out)
}

function expectBlq1Error(fn: () => unknown, reason?: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(Blq1Error)
    if (reason) expect((error as Blq1Error).reason).toBe(reason)
    return
  }
  throw new Error('expected a Blq1Error')
}

async function writeTemp(name: string, data: Uint8Array): Promise<string> {
  const path = join(dir, `${name}-${randomBytes(4).toString('hex')}.blq1`)
  writeFileSync(path, data)
  return path
}

describe('BLQ1 header', () => {
  it('encodes magic, version, key id, segment size, salt and nonce prefix in 49 bytes', () => {
    const salt = randomBytes(32)
    const noncePrefix = randomBytes(7)
    const header = encodeHeader({ segmentSize: BLQ1_SEGMENT_SIZE, salt, noncePrefix })
    expect(header.length).toBe(BLQ1_HEADER_SIZE)
    expect(header.subarray(0, 4).toString('ascii')).toBe('BLQ1')
    expect(header[4]).toBe(1)
    expect(header[5]).toBe(1)
    expect(header.readUInt32BE(6)).toBe(1024 * 1024)
    expect(header.subarray(10, 42).equals(salt)).toBe(true)
    expect(header.subarray(42, 49).equals(noncePrefix)).toBe(true)
    const parsed = parseHeader(header)
    expect(parsed.segmentSize).toBe(BLQ1_SEGMENT_SIZE)
    expect(parsed.bytes.equals(header)).toBe(true)
  })

  it('rejects bad magic, versions, key ids, segment sizes and short input', () => {
    const header = encodeHeader({ segmentSize: SEG, salt: randomBytes(32), noncePrefix: randomBytes(7) })
    const mutate = (at: number, value: number) => {
      const copy = Buffer.from(header)
      copy[at] = value
      return copy
    }
    expectBlq1Error(() => parseHeader(mutate(0, 0x58)), 'header')
    expectBlq1Error(() => parseHeader(mutate(4, 2)), 'version')
    expectBlq1Error(() => parseHeader(mutate(5, 2)), 'key_id')
    const tooSmall = Buffer.from(header)
    tooSmall.writeUInt32BE(63, 6)
    expectBlq1Error(() => parseHeader(tooSmall), 'segment_size')
    const tooLarge = Buffer.from(header)
    tooLarge.writeUInt32BE(16 * 1024 * 1024 + 1, 6)
    expectBlq1Error(() => parseHeader(tooLarge), 'segment_size')
    expectBlq1Error(() => parseHeader(header.subarray(0, 48)), 'truncated')
  })

  it('accepts segment sizes from 64 B to 16 MiB only when writing', () => {
    expect(() => encodeHeader({ segmentSize: 63, salt: randomBytes(32), noncePrefix: randomBytes(7) })).toThrow(RangeError)
    expect(() => encryptBuffer(Buffer.alloc(1), opts({ segmentSize: 16 * 1024 * 1024 + 1 }))).toThrow(RangeError)
  })
})

describe('BLQ1 size math', () => {
  it.each([0, 1, SEG - 1, SEG, SEG + 1, 3 * SEG, 3 * SEG + 5])('derives the plaintext size of %i bytes from the file size', (size) => {
    const file = encryptBuffer(randomBytes(size), opts())
    expect(file.length).toBe(encryptedSize(size, SEG))
    const layout = layoutForFileSize(file.length, SEG)
    expect(layout.plaintextSize).toBe(size)
    expect(layout.segmentCount).toBe(Math.floor(size / SEG) + 1)
    expect(layout.finalSize).toBe(size % SEG)
  })

  it('rejects file sizes no BLQ1 file can have', () => {
    expectBlq1Error(() => layoutForFileSize(BLQ1_HEADER_SIZE + BLQ1_TAG_SIZE - 1, SEG), 'truncated')
    // A full-size last segment would be a full segment without its final segment.
    expectBlq1Error(() => layoutForFileSize(BLQ1_HEADER_SIZE + SEG + BLQ1_TAG_SIZE, SEG), 'truncated')
  })
})

describe('BLQ1 round trips', () => {
  const sizes = [0, 1, SEG - 1, SEG, SEG + 1, 2 * SEG, 17 * SEG + 3]

  it.each(sizes)('buffer helpers round-trip %i bytes', (size) => {
    const plaintext = randomBytes(size)
    expect(decryptBuffer(encryptBuffer(plaintext, opts()), opts()).equals(plaintext)).toBe(true)
  })

  it.each(sizes)('streams round-trip %i bytes with odd write boundaries', async (size) => {
    const plaintext = randomBytes(size)
    const encrypted = await throughStream(plaintext, createEncryptStream(opts()), 5)
    expect(encrypted.length).toBe(encryptedSize(size, SEG))
    // Stream output is readable by the buffer helper and the other way round.
    expect(decryptBuffer(encrypted, opts()).equals(plaintext)).toBe(true)
    const decrypted = await throughStream(encryptBuffer(plaintext, opts()), createDecryptStream(opts()), 3)
    expect(decrypted.equals(plaintext)).toBe(true)
  })

  it('round-trips many production-size segments', async () => {
    const plaintext = randomBytes(3 * BLQ1_SEGMENT_SIZE + 12_345)
    const encrypted = await throughStream(plaintext, createEncryptStream({ masterKey, info }), 64 * 1024)
    expect(parseHeader(encrypted).segmentSize).toBe(BLQ1_SEGMENT_SIZE)
    const decrypted = await throughStream(encrypted, createDecryptStream({ masterKey, info }), 100_000)
    expect(decrypted.equals(plaintext)).toBe(true)
  })

  it('uses a fresh salt and nonce prefix for every file', () => {
    const a = encryptBuffer(Buffer.from('same'), opts())
    const b = encryptBuffer(Buffer.from('same'), opts())
    expect(a.subarray(10, 49).equals(b.subarray(10, 49))).toBe(false)
    expect(a.subarray(49).equals(b.subarray(49))).toBe(false)
  })

  it('matches an independent implementation of the documented format', () => {
    // Built from the spec with raw node:crypto: HKDF(master, salt, info), IV = prefix ‖ u32be(i) ‖ lastFlag, AAD = header.
    const salt = randomBytes(32)
    const prefix = randomBytes(7)
    const header = Buffer.concat([Buffer.from('BLQ1'), Buffer.from([1, 1, 0, 0, 0, SEG]), salt, prefix])
    const key = Buffer.from(hkdfSync('sha256', masterKey, salt, info, 32))
    const plaintext = randomBytes(2 * SEG + 10)
    const seal = (index: number, last: boolean, data: Buffer) => {
      const iv = Buffer.alloc(12)
      prefix.copy(iv)
      iv.writeUInt32BE(index, 7)
      iv[11] = last ? 1 : 0
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
      cipher.setAAD(header)
      return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
    }
    const file = Buffer.concat([
      header,
      seal(0, false, plaintext.subarray(0, SEG)),
      seal(1, false, plaintext.subarray(SEG, 2 * SEG)),
      seal(2, true, plaintext.subarray(2 * SEG)),
    ])
    expect(decryptBuffer(file, opts()).equals(plaintext)).toBe(true)
  })
})

describe('BLQ1 tamper detection', () => {
  const plaintext = randomBytes(3 * SEG + 20)
  const file = encryptBuffer(plaintext, opts())
  const stride = SEG + BLQ1_TAG_SIZE

  it('fails on a flipped bit in any header field', () => {
    // Magic, version, key id and size fields fail the parser; salt and nonce prefix fail authentication.
    for (const at of [0, 4, 5, 9, 10, 41, 42, 48]) {
      const copy = Buffer.from(file)
      copy[at]! ^= 0x01
      expectBlq1Error(() => decryptBuffer(copy, opts()))
    }
  })

  it('fails on a flipped bit in ciphertext or tag of every segment', () => {
    for (const at of [BLQ1_HEADER_SIZE, BLQ1_HEADER_SIZE + SEG, BLQ1_HEADER_SIZE + stride + 3, file.length - 1, file.length - 17]) {
      const copy = Buffer.from(file)
      copy[at]! ^= 0x80
      expectBlq1Error(() => decryptBuffer(copy, opts()), 'authentication')
    }
  })

  it('fails on truncation at a segment boundary, mid-segment and inside the header', () => {
    expectBlq1Error(() => decryptBuffer(file.subarray(0, BLQ1_HEADER_SIZE + 3 * stride), opts()), 'truncated')
    expectBlq1Error(() => decryptBuffer(file.subarray(0, BLQ1_HEADER_SIZE + 2 * stride), opts()))
    expectBlq1Error(() => decryptBuffer(file.subarray(0, BLQ1_HEADER_SIZE + stride + 30), opts()))
    expectBlq1Error(() => decryptBuffer(file.subarray(0, 20), opts()), 'truncated')
    expectBlq1Error(() => decryptBuffer(file.subarray(0, file.length - 1), opts()))
  })

  it('fails when an appended segment or trailing bytes follow the final segment', () => {
    expectBlq1Error(() => decryptBuffer(Buffer.concat([file, Buffer.alloc(BLQ1_TAG_SIZE)]), opts()))
  })

  it('fails when segments are swapped', () => {
    const copy = Buffer.from(file)
    const first = Buffer.from(file.subarray(BLQ1_HEADER_SIZE, BLQ1_HEADER_SIZE + stride))
    file.copy(copy, BLQ1_HEADER_SIZE, BLQ1_HEADER_SIZE + stride, BLQ1_HEADER_SIZE + 2 * stride)
    first.copy(copy, BLQ1_HEADER_SIZE + stride)
    expectBlq1Error(() => decryptBuffer(copy, opts()), 'authentication')
  })

  it('fails for another recording id, another chunk position, another key or an unknown key id', () => {
    expectBlq1Error(() => decryptBuffer(file, opts({ info: recordingInfo('0199a3b4-0000-7000-8000-000000000002') })), 'authentication')
    const chunk = encryptBuffer(plaintext, opts({ info: chunkInfo(ID, 3) }))
    expect(decryptBuffer(chunk, opts({ info: chunkInfo(ID, 3) })).equals(plaintext)).toBe(true)
    expectBlq1Error(() => decryptBuffer(chunk, opts({ info: chunkInfo(ID, 4) })), 'authentication')
    expectBlq1Error(() => decryptBuffer(chunk, opts()), 'authentication')
    expectBlq1Error(() => decryptBuffer(file, opts({ masterKey: randomBytes(32) })), 'authentication')
    const unknownKey = Buffer.from(file)
    unknownKey[5] = 2
    expectBlq1Error(() => decryptBuffer(unknownKey, opts()), 'key_id')
  })

  it('errors the decrypt stream on tampering and truncation', async () => {
    const tampered = Buffer.from(file)
    tampered[BLQ1_HEADER_SIZE + stride + 1]! ^= 0x01
    await expect(throughStream(tampered, createDecryptStream(opts()))).rejects.toBeInstanceOf(Blq1Error)
    await expect(throughStream(file.subarray(0, BLQ1_HEADER_SIZE + 2 * stride), createDecryptStream(opts()))).rejects.toBeInstanceOf(
      Blq1Error,
    )
    await expect(throughStream(Buffer.alloc(0), createDecryptStream(opts()))).rejects.toBeInstanceOf(Blq1Error)
  })
})

describe('BLQ1 random-access reader', () => {
  it('returns exactly the plaintext slice for every (a, b) range of a small file', async () => {
    const plaintext = randomBytes(2 * SEG + 22)
    const path = await writeTemp('ranges', encryptBuffer(plaintext, opts()))
    const reader = await openBlq1File(path, opts())
    try {
      expect(reader.plaintextSize).toBe(plaintext.length)
      expect(reader.segmentCount).toBe(3)
      for (let a = 0; a < plaintext.length; a++) {
        for (let b = a; b < plaintext.length; b++) {
          const parts: Buffer[] = []
          for await (const part of reader.range(a, b)) parts.push(part)
          const got = Buffer.concat(parts)
          if (!got.equals(plaintext.subarray(a, b + 1))) throw new Error(`range ${a}-${b} differs`)
        }
      }
    } finally {
      await reader.close()
    }
  })

  it('reads segment-boundary ranges of a multi-segment file and every segment in order', async () => {
    const plaintext = randomBytes(5 * SEG)
    const path = await writeTemp('boundaries', encryptBuffer(plaintext, opts()))
    const reader = await openBlq1File(path, opts())
    try {
      expect(reader.segmentCount).toBe(6)
      await reader.verifyFinal()
      for (const [a, b] of [
        [SEG - 1, SEG],
        [SEG, 2 * SEG - 1],
        [2 * SEG - 1, 4 * SEG],
        [0, 5 * SEG - 1],
        [5 * SEG - 1, 5 * SEG - 1],
      ] as const) {
        expect(Buffer.concat(await Array.fromAsync(reader.range(a, b))).equals(plaintext.subarray(a, b + 1))).toBe(true)
      }
      expect(Buffer.concat(await Array.fromAsync(reader.segments())).equals(plaintext)).toBe(true)
      await expect(Array.fromAsync(reader.range(0, 5 * SEG))).rejects.toThrow(RangeError)
    } finally {
      await reader.close()
    }
  })

  it('detects truncation on open or when the final segment is verified, and tampering per segment', async () => {
    const plaintext = randomBytes(3 * SEG + 9)
    const file = encryptBuffer(plaintext, opts())
    const stride = SEG + BLQ1_TAG_SIZE
    await expect(openBlq1File(await writeTemp('trunc-boundary', file.subarray(0, BLQ1_HEADER_SIZE + 3 * stride)), opts())).rejects.toBeInstanceOf(
      Blq1Error,
    )
    const cut = await openBlq1File(await writeTemp('trunc-mid', file.subarray(0, BLQ1_HEADER_SIZE + 2 * stride + 40)), opts())
    try {
      await expect(cut.verifyFinal()).rejects.toBeInstanceOf(Blq1Error)
    } finally {
      await cut.close()
    }
    const tampered = Buffer.from(file)
    tampered[BLQ1_HEADER_SIZE + stride + 5]! ^= 0x10
    const reader = await openBlq1File(await writeTemp('tampered', tampered), opts())
    try {
      await reader.verifyFinal()
      expect((await reader.readSegment(0)).equals(plaintext.subarray(0, SEG))).toBe(true)
      await expect(reader.readSegment(1)).rejects.toBeInstanceOf(Blq1Error)
    } finally {
      await reader.close()
    }
  })

  it('decrypts a file written by the encrypt stream', async () => {
    const plaintext = randomBytes(4 * SEG + 1)
    const encrypted = await collect(Readable.from([plaintext]).pipe(createEncryptStream(opts())))
    const reader = await openBlq1File(await writeTemp('stream', encrypted), opts())
    try {
      expect(Buffer.concat(await Array.fromAsync(reader.segments())).equals(plaintext)).toBe(true)
    } finally {
      await reader.close()
    }
  })
})
