/**
 * Test-only helpers (docs/TESTING.md §6.6). Imported dynamically behind `__BLINQ_TEST_HOOKS__`, so production bundles
 * contain none of this.
 *
 * - `useFakeScreenSource(true)`: screen share captures a synthetic 1920×1080 canvas instead of `getDisplayMedia`.
 * - `publishUnencryptedTrack()`: publishes a canvas video track announced as unencrypted. From a client joined with
 *   `e2ee=off` it is plaintext (`call/unencrypted-blocked`). From an encrypting client it is what a compromised SFU
 *   could claim about any participant: one publication marked NONE next to encrypted ones (`media/mixed-encryption`).
 *   Peers must never subscribe to it, nor to anything else of that participant.
 */
import { Encryption_Type, LocalVideoTrack, Track, type Room } from 'livekit-client'

let fakeScreen = false

export function setFakeScreenSource(enabled: boolean): void {
  fakeScreen = enabled
}

export function fakeScreenSourceEnabled(): boolean {
  return fakeScreen
}

export interface CanvasSource {
  track: MediaStreamTrack
  stop(): void
}

/** An animated canvas captured at `fps`. Drawn on a timer (rAF stops in background tabs). */
export function canvasSource(width: number, height: number, fps: number, label: string): CanvasSource {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is not available')
  let frame = 0
  const draw = () => {
    frame++
    context.fillStyle = '#10222b'
    context.fillRect(0, 0, width, height)
    // Fine detail and text, like a real shared screen.
    context.strokeStyle = '#2d5563'
    context.lineWidth = 1
    for (let x = 0; x < width; x += 32) {
      context.beginPath()
      context.moveTo(x + 0.5, 0)
      context.lineTo(x + 0.5, height)
      context.stroke()
    }
    context.fillStyle = '#7fd4e0'
    context.font = `${Math.round(height / 12)}px sans-serif`
    context.fillText(`${label} ${width}x${height}`, width * 0.06, height * 0.2)
    context.font = `${Math.round(height / 30)}px monospace`
    context.fillText(`frame ${frame}`, width * 0.06, height * 0.3)
    const x = ((frame * 12) % (width + 200)) - 200
    context.fillStyle = '#e8b04b'
    context.fillRect(x, height * 0.55, 200, height * 0.2)
  }
  draw()
  const timer = setInterval(draw, Math.max(10, Math.round(1000 / fps)))
  const stream = canvas.captureStream(fps)
  const track = stream.getVideoTracks()[0]
  if (!track) throw new Error('Canvas capture is not available')
  return {
    track,
    stop: () => {
      clearInterval(timer)
      track.stop()
    },
  }
}

const UNENCRYPTED_TRACK_NAME = 'unencrypted-test'

/**
 * Publishes a track the SFU announces as unencrypted: a camera-source track from an `e2ee=off` client, or a
 * screen-share-source track whose publish request says NONE from an encrypting client (its frames stay encrypted).
 */
export async function publishUnencryptedTrack(room: Room): Promise<void> {
  const source = canvasSource(640, 360, 15, 'unencrypted')
  const track = new LocalVideoTrack(source.track, undefined, true)
  track.on('ended', () => source.stop())
  const options = { name: UNENCRYPTED_TRACK_NAME, simulcast: false }
  if (!room.isE2EEEnabled) {
    await room.localParticipant.publishTrack(track, { ...options, source: Track.Source.Camera })
    return
  }
  // The publish request copies `encryptionType` (internal to the SDK); every other track keeps GCM.
  const local = room.localParticipant as unknown as { encryptionType: Encryption_Type }
  const previous = local.encryptionType
  local.encryptionType = Encryption_Type.NONE
  try {
    await room.localParticipant.publishTrack(track, { ...options, source: Track.Source.ScreenShare })
  } finally {
    local.encryptionType = previous
  }
}

/** Unpublishes and stops the track `publishUnencryptedTrack` published. */
export async function unpublishUnencryptedTrack(room: Room): Promise<void> {
  for (const publication of room.localParticipant.trackPublications.values()) {
    if (publication.trackName !== UNENCRYPTED_TRACK_NAME || !publication.track) continue
    await room.localParticipant.unpublishTrack(publication.track, true)
  }
}
