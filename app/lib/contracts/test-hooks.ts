/**
 * Test-only browser hooks (window.__blinqTest). Exist only when __BLINQ_TEST_HOOKS__ is true (pnpm build:test / dev).
 * Production builds drop every reference because the flag is a compile-time constant.
 */
export interface BlinqTestHooks {
  /** performance.mark timestamps: click → connected → first remote frame. */
  metrics: Record<string, number>
  /** Replace getDisplayMedia with a synthetic 1920x1080 canvas source (deterministic screen share). */
  useFakeScreenSource?: (enabled: boolean) => void
  /** Publish one unencrypted track from this client (negative test for unencrypted-media blocking). */
  publishUnencryptedTrack?: () => Promise<void>
  /** Force a MediaRecorder MIME type (recording format tests). */
  forceRecordingMime?: (mime: string | null) => void
  /**
   * Runs the RNNoise chain over seeded synthetic noise in an OfflineAudioContext and returns input/output RMS in dBFS
   * (media-fx). Used by the >= 10 dB reduction test.
   */
  measureNoiseSuppression?: () => Promise<{ inputDb: number; outputDb: number }>
  /** Arbitrary state snapshots features choose to expose. */
  state: Record<string, unknown>
}

declare global {
  interface Window {
    __blinqTest?: BlinqTestHooks
  }
}

export function testHooks(): BlinqTestHooks | undefined {
  if (!__BLINQ_TEST_HOOKS__ || typeof window === 'undefined') return undefined
  window.__blinqTest ??= { metrics: {}, state: {} }
  return window.__blinqTest
}
