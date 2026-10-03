import { expect, test } from '../fixtures'
import { inboundAudio, waitForRemoteFrames } from '../fixtures/livekit'
import {
  canRecordFamily,
  downloadRecording,
  forceRecordingMime,
  probe,
  recordingState,
  startRecording,
  stopRecording,
  volume,
  waitForRecording,
} from '../fixtures/recording'

// DoD (docs/stages/08-recording.md): both formats reach `ready`; ffprobe shows ≈ 10 s with one H.264 video and one AAC
// audio stream; the audio is not silent. The host records with its own mic off, so the sound in the file is the
// participant's encrypted remote audio, which proves the mix.
const RECORD_MS = 10_000
const TOLERANCE_S = 1.5

test.describe.configure({ timeout: 150_000 })

for (const family of ['video/webm', 'video/mp4'] as const) {
  test(`a two-person call recorded as ${family} reaches ready with sound and picture`, async ({
    recordingCall,
  }, testInfo) => {
    const { room, host } = await recordingCall.open({ params: { mic: '0' } })
    // A type the browser cannot record (MP4 in Firefox) is skipped with an annotation, never passed.
    test.skip(!(await canRecordFamily(host.page, family)), `MediaRecorder cannot record ${family} in this browser`)
    const peer = await recordingCall.join(room, host.account, { name: 'Pat Participant' })
    await waitForRemoteFrames(host.page, peer.identity, 10)
    await expect
      .poll(async () => (await inboundAudio(host.page, peer.identity))[0]?.totalAudioEnergy ?? 0, {
        message: 'the host hears the participant',
        timeout: 20_000,
      })
      .toBeGreaterThan(0)

    await forceRecordingMime(host.page, family)
    const id = await startRecording(host.page, 'server')
    expect((await recordingState(host.page))?.mime).toMatch(new RegExp(`^${family}`))
    await host.page.waitForTimeout(RECORD_MS)
    const final = await stopRecording(host.page)
    expect(final.error).toBeNull()
    expect(final.chunksAcked).toBe(final.chunksProduced)
    // WebM slices every 4 s; Chrome's MP4 muxer cuts fragments at keyframes, so it can deliver fewer, larger chunks.
    expect(final.chunksProduced).toBeGreaterThanOrEqual(2)

    const summary = await waitForRecording(host.account, id, ['ready'])
    expect(summary.partial).toBe(false)
    const file = testInfo.outputPath(`recording-${family.replace('/', '-')}.mp4`)
    await downloadRecording(host.account, id, file)

    const info = await probe(file)
    const video = info.streams.filter((stream) => stream.codec_type === 'video')
    const audio = info.streams.filter((stream) => stream.codec_type === 'audio')
    expect(video.map((stream) => stream.codec_name)).toEqual(['h264'])
    expect(audio.map((stream) => stream.codec_name)).toEqual(['aac'])
    expect(info.durationSec).not.toBeNull()
    expect(Math.abs(info.durationSec! - RECORD_MS / 1000)).toBeLessThanOrEqual(TOLERANCE_S)

    const level = await volume(file)
    testInfo.annotations.push({ type: 'volume', description: `mean ${level.meanDb} dB, max ${level.maxDb} dB` })
    expect(level.meanDb).toBeGreaterThan(-50)
  })
}
