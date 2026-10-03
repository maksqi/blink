import { expect, test } from '../fixtures'
import {
  downloadRecording,
  injectChunkFailures,
  probe,
  recordingState,
  startRecording,
  stopRecording,
  waitForRecording,
} from '../fixtures/recording'

// DoD (docs/stages/08-recording.md): chunk failures injected with page.route still produce a complete file: every
// third upload attempt is aborted (network error) and the second one answers 503; the uploader retries the same seq,
// completes with `chunkCount` = chunks produced, and the processed file covers the whole recording.
const RECORD_MS = 14_000

test.describe.configure({ timeout: 150_000 })

test('aborted and failed chunk uploads are retried and the file is complete', async ({
  recordingCall,
  guards,
}, testInfo) => {
  // The browser logs the injected failures; they are the point of this test.
  guards.allowConsoleError(/Failed to load resource/)
  guards.allowConsoleError(/ERR_FAILED/)
  const { room, host } = await recordingCall.open()
  await recordingCall.join(room, host.account, { name: 'Pat Participant' })
  const stats = await injectChunkFailures(host.page, { abortEvery: 3, serviceUnavailable: [2] })

  const id = await startRecording(host.page, 'server')
  const complete = host.page.waitForRequest((request) => request.url().endsWith(`/api/recordings/${id}/complete`))
  await host.page.waitForTimeout(RECORD_MS)
  const final = await stopRecording(host.page, 90_000)
  const body = (await complete).postDataJSON() as { chunkCount: number; durationMs: number }

  testInfo.annotations.push({ type: 'uploads', description: JSON.stringify({ ...stats, ...final }) })
  expect(stats.aborted).toBeGreaterThanOrEqual(1)
  expect(stats.failed).toBe(1)
  expect(final.error).toBeNull()
  expect(final.retries).toBe(stats.aborted + stats.failed)
  expect(body.chunkCount).toBe(final.chunksProduced)
  expect((await recordingState(host.page))?.chunksAcked).toBe(final.chunksProduced)

  const summary = await waitForRecording(host.account, id, ['ready'])
  expect(summary.partial).toBe(false)
  const file = testInfo.outputPath('chunk-failures.mp4')
  await downloadRecording(host.account, id, file)
  const info = await probe(file)
  expect(info.durationSec).not.toBeNull()
  expect(Math.abs(info.durationSec! - RECORD_MS / 1000)).toBeLessThanOrEqual(1.5)
})
