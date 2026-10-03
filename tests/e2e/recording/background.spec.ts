import { expect, test } from '../fixtures'
import {
  downloadRecording,
  emulateBackgroundTab,
  framesDrawn,
  freezes,
  probe,
  recordingState,
  setBackground,
  startRecording,
  stopRecording,
  waitForRecording,
} from '../fixtures/recording'

// DoD (docs/stages/08-recording.md, agent-manual, automated here as @nightly): recording keeps going for 60 s with
// the recorder's tab in the background. Playwright cannot hide a real tab, so the page gets what a hidden tab gets
// (`emulateBackgroundTab`: visibility hidden, no rAF, main-thread timers at most once per second) while the worker
// clock is left alone. The compositor must keep drawing at ~30 fps, chunks must keep coming, and the processed file
// must be ≥ 60 s long without a frozen stretch (ffmpeg freezedetect, 0.5 s at -60 dB) while the cameras keep moving.
const BACKGROUND_MS = 60_000

test.describe.configure({ timeout: 240_000 })

test(
  'a recording keeps every frame while the recorder tab is in the background',
  { tag: '@nightly' },
  async ({ recordingCall, page }, testInfo) => {
    await emulateBackgroundTab(page)
    const { room, host } = await recordingCall.open()
    await recordingCall.join(room, host.account, { name: 'Pat Participant' })

    const id = await startRecording(host.page, 'server')
    await setBackground(host.page, true)
    expect(await host.page.evaluate(() => document.visibilityState)).toBe('hidden')

    // Main-thread timers are throttled now: a 33 ms interval fires about once per second.
    const mainTicks = await host.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0
          const timer = setInterval(() => count++, 33)
          setTimeout(() => {
            clearInterval(timer)
            resolve(count)
          }, 3000)
        }),
    )
    expect(mainTicks).toBeLessThanOrEqual(5)

    const before = {
      frames: await framesDrawn(host.page),
      chunks: (await recordingState(host.page))?.chunksProduced ?? 0,
    }
    const startedAt = Date.now()
    await host.page.waitForTimeout(BACKGROUND_MS)
    const seconds = (Date.now() - startedAt) / 1000
    const after = {
      frames: await framesDrawn(host.page),
      chunks: (await recordingState(host.page))?.chunksProduced ?? 0,
    }
    const fps = (after.frames - before.frames) / seconds
    expect(fps).toBeGreaterThanOrEqual(25)
    // Chunks kept coming while hidden (WebM every 4 s; Chrome's MP4 muxer cuts larger fragments at keyframes).
    expect(after.chunks - before.chunks).toBeGreaterThanOrEqual(BACKGROUND_MS / 10_000)

    await setBackground(host.page, false)
    await stopRecording(host.page)
    await waitForRecording(host.account, id, ['ready'], 180_000)

    const file = testInfo.outputPath('background.mp4')
    await downloadRecording(host.account, id, file)
    const info = await probe(file)
    const frozen = await freezes(file, 0.5)
    testInfo.annotations.push({
      type: 'background-check',
      description: JSON.stringify({
        mainTicks,
        fps: Math.round(fps * 10) / 10,
        before,
        after,
        durationSec: info.durationSec,
        frozen,
      }),
    })
    expect(info.durationSec).toBeGreaterThanOrEqual(BACKGROUND_MS / 1000)
    expect(frozen).toEqual([])
  },
)
