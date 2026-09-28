import { describe, expect, it } from 'vitest'
import { toBase64Url, utf8 } from './encoding'
import { EnvelopeError, openAppMessage, sealAppMessage, type AppMessage } from './envelope'
import { deriveMeetingKeys } from './keys'

const slug = 'abc-defg-hjk'
const epoch = toBase64Url(new Uint8Array(16).fill(7))

async function chatKey(seed = 1) {
  const key = Uint8Array.from({ length: 32 }, (_, i) => (i * seed) & 0xff)
  return (await deriveMeetingKeys(key, epoch, slug)).chatKey
}

const message = (from = 'p_alice00000000000'): AppMessage => ({
  id: crypto.randomUUID(),
  type: 'chat',
  from,
  ts: 1_700_000_000_000,
  body: { text: 'hello <script>alert(1)</script>' },
})

describe('app-message envelope', () => {
  it('round-trips and does not contain the plaintext', async () => {
    const key = await chatKey()
    const original = message()
    const sealed = await sealAppMessage(key, slug, original)
    expect(sealed[0]).toBe(0x01)
    expect(Buffer.from(sealed).includes(Buffer.from('hello'))).toBe(false)
    await expect(openAppMessage(key, slug, original.from, sealed)).resolves.toEqual(original)
  })

  it('rejects a different sender identity (AAD binding)', async () => {
    const key = await chatKey()
    const sealed = await sealAppMessage(key, slug, message('p_alice00000000000'))
    await expect(openAppMessage(key, slug, 'p_mallory000000000', sealed)).rejects.toBeInstanceOf(EnvelopeError)
  })

  it('rejects another room slug, another key, tampering and bad versions', async () => {
    const key = await chatKey()
    const m = message()
    const sealed = await sealAppMessage(key, slug, m)
    await expect(openAppMessage(key, 'abc-defg-hjm', m.from, sealed)).rejects.toBeInstanceOf(EnvelopeError)
    await expect(openAppMessage(await chatKey(3), slug, m.from, sealed)).rejects.toBeInstanceOf(EnvelopeError)
    const tampered = sealed.slice()
    tampered[tampered.length - 1]! ^= 1
    await expect(openAppMessage(key, slug, m.from, tampered)).rejects.toBeInstanceOf(EnvelopeError)
    const wrongVersion = sealed.slice()
    wrongVersion[0] = 0x02
    await expect(openAppMessage(key, slug, m.from, wrongVersion)).rejects.toBeInstanceOf(EnvelopeError)
    await expect(openAppMessage(key, slug, m.from, utf8('plaintext'))).rejects.toBeInstanceOf(EnvelopeError)
  })

  it('refuses oversized messages', async () => {
    const key = await chatKey()
    const big = { ...message(), body: { text: 'x'.repeat(16 * 1024) } }
    await expect(sealAppMessage(key, slug, big)).rejects.toBeInstanceOf(EnvelopeError)
  })
})
