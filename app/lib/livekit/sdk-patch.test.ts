/**
 * livekit-client 2.22.3 sends encrypted data packets without `encryption_type`, so receivers report NONE even after a
 * successful decryption, and `messaging.ts` (which requires E2EE) would drop every chat message and reaction.
 * `patches/livekit-client@2.22.3.patch` sets it. pnpm keys the patch by version: after an upgrade it silently stops
 * applying, and this test fails until the new version is checked (and the patch dropped once upstream fixed it).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// The CommonJS entry (dist/livekit-client.umd.js) sits next to the ES module build the browser bundles.
const distDir = dirname(require.resolve('livekit-client'))

describe('livekit-client data packet encryption type', () => {
  it('marks the encrypted data packets it sends as GCM', () => {
    const bundle = readFileSync(join(distDir, 'livekit-client.esm.mjs'), 'utf8')
    const send = bundle.slice(bundle.indexOf('sendDataPacket(packet'))
    const packet = send.slice(
      send.indexOf('new EncryptedPacket({'),
      send.indexOf('})', send.indexOf('new EncryptedPacket({')),
    )
    expect(packet).toContain('encryptionType: Encryption_Type.GCM')
  })
})
