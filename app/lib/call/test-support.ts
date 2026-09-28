/**
 * Test-only helpers (docs/TESTING.md §6.6). Imported dynamically behind `__BLINQ_TEST_HOOKS__`, so production bundles
 * contain none of this.
 *
 * - `useFakeScreenSource(true)`: screen share captures a synthetic 1920×1080 canvas instead of `getDisplayMedia`.
 * - `publishUnencryptedTrack()`: publishes a canvas video track from a client joined with `e2ee=off`; peers must never
 *   subscribe to it (`call/unencrypted-blocked`).
 */
import { LocalVideoTrack, Track, type Room } from 'livekit-client'

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

/** Publishes an unencrypted camera-source track (only meaningful from an `e2ee=off` harness client). */
export async function publishUnencryptedTrack(room: Room): Promise<void> {
  if (room.isE2EEEnabled) throw new Error('publishUnencryptedTrack needs a client joined with e2ee=off')
  const source = canvasSource(640, 360, 15, 'unencrypted')
  const track = new LocalVideoTrack(source.track, undefined, true)
  track.on('ended', () => source.stop())
  await room.localParticipant.publishTrack(track, { source: Track.Source.Camera, name: 'unencrypted-test', simulcast: false })
}
