/**
 * Guards for `patches/livekit-client@2.22.3.patch`. pnpm keys a patch by version: after an upgrade it silently stops
 * applying, and these tests fail until the new version is checked (and each part dropped once upstream fixed it).
 *
 * - Data packets: 2.22.3 sends encrypted data packets without `encryption_type`, so receivers report NONE even after a
 *   successful decryption, and `messaging.ts` (which requires E2EE) would drop every chat message and reaction.
 * - E2EE worker (F-015): the decrypt flag is per participant and every `TrackPublished` overwrites it, so one
 *   publication announced as unencrypted turned decryption off for all of that participant's tracks, and the worker
 *   then passed frames to the decoder undecrypted. Patched, it drops them (and never encodes without encryption).
 * - Room (F-037): the `devicechange` listener kept every Room alive through its constructor's closure context; the
 *   iOS silent-audio `visibilitychange` listener was never removed.
 * - Engine (F-006): a server-side close (room deleted, participant removed) logged data channel errors when the SCTP
 *   abort arrived before the leave message.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// The CommonJS entry (dist/livekit-client.umd.js) sits next to the ES module builds the browser bundles.
const distDir = dirname(require.resolve('livekit-client'))
const bundle = readFileSync(join(distDir, 'livekit-client.esm.mjs'), 'utf8')
const worker = readFileSync(join(distDir, 'livekit-client.e2ee.worker.mjs'), 'utf8')
/** The frame cryptor (its base class only has throwing stubs of the same methods). */
const cryptor = worker.slice(worker.indexOf('class FrameCryptor extends BaseFrameCryptor'))

/** The brace-balanced block that starts at the first `{` after `marker` (searching from `from`). */
function blockAfter(source: string, marker: string, from = 0): string {
  const at = source.indexOf(marker, from)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  const open = source.indexOf('{', at + marker.length - 1)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return source.slice(open, index + 1)
  }
  throw new Error(`unbalanced block after ${marker}`)
}

describe('livekit-client patch', () => {
  it('marks the encrypted data packets it sends as GCM', () => {
    const send = bundle.slice(bundle.indexOf('sendDataPacket(packet'))
    const packet = send.slice(
      send.indexOf('new EncryptedPacket({'),
      send.indexOf('})', send.indexOf('new EncryptedPacket({')),
    )
    expect(packet).toContain('encryptionType: Encryption_Type.GCM')
  })

  it('drops incoming frames of a participant whose decrypt flag is off instead of passing them through', () => {
    const decode = blockAfter(cryptor, 'decodeFunction(encodedFrame, controller) {')
    const offBranch = blockAfter(decode, 'if (!encryptionEnabled) {')
    expect(offBranch).toContain('return;')
    expect(offBranch).not.toContain('enqueue')
  })

  it('never sends a frame unencrypted', () => {
    const encode = blockAfter(cryptor, 'encodeFunction(encodedFrame, controller) {')
    const offBranch = blockAfter(encode, 'if (!this.isEnabled()) {')
    expect(offBranch).toContain('return;')
    expect(offBranch).not.toContain('enqueue')
  })

  it('registers the devicechange listener without capturing the Room', () => {
    const constructor = blockAfter(bundle, 'class Room extends eventsExports.EventEmitter {')
    expect(constructor).toContain('blinqWatchDeviceChanges(this)')
    expect(constructor).not.toContain('new WeakRef(this)')
    const helper = blockAfter(bundle, 'function blinqWatchDeviceChanges(room) {')
    expect(helper).toContain('new WeakRef(room)')
    expect(helper).not.toMatch(/\bthis\b/)
  })

  it('removes the iOS silent-audio visibilitychange listener on disconnect', () => {
    expect(bundle).toContain("document.addEventListener('visibilitychange', onVisibilityChange)")
    expect(bundle).toContain("document.removeEventListener('visibilitychange', onVisibilityChange)")
    const listener = blockAfter(bundle, 'function blinqDummyAudioVisibilityListener(room, element, stream) {')
    expect(listener).not.toMatch(/\bthis\b/)
  })

  it('reports data channel errors only when the engine is still open after the grace period', () => {
    const onError = blockAfter(bundle, 'this.handleDataError = event =>')
    expect(onError).toContain('setTimeout(')
    expect(onError).toContain('BLINQ_SERVER_CLOSE_GRACE_MS')
    const onClose = blockAfter(bundle, 'this.handleDataChannelClose = kind => () =>')
    expect(onClose).toContain('setTimeout(')
  })
})
