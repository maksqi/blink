import { fileNamePart } from '../../../app/lib/recording/local-file'
import { expect, test } from '../fixtures'
import { getRecording, probe, recordingState, startRecording, stopRecording } from '../fixtures/recording'

// DoD (docs/stages/08-recording.md): local-only mode downloads the file and uploads nothing.
test.describe.configure({ timeout: 120_000 })

test('local-only mode saves a playable file on this device and uploads nothing', async ({
  recordingCall,
}, testInfo) => {
  const { room, host } = await recordingCall.open()
  await recordingCall.join(room, host.account, { name: 'Pat Participant' })

  const uploads: string[] = []
  host.page.on('request', (request) => {
    if (/\/api\/recordings\/[^/]+\/(chunks|complete)/.test(request.url())) uploads.push(request.url())
  })

  const id = await startRecording(host.page, 'local')
  expect((await recordingState(host.page))?.mode).toBe('local')
  await expect(host.page.getByTestId('recording-indicator')).toHaveAttribute('data-mode', 'local')
  await host.page.waitForTimeout(6000)

  const downloadEvent = host.page.waitForEvent('download')
  const final = await stopRecording(host.page)
  const download = await downloadEvent
  expect(final.error).toBeNull()
  expect(final.chunksProduced).toBeGreaterThanOrEqual(2)

  // F-009: named after the meeting's name as the call shows it (not the slug).
  const meeting = (await host.page.getByTestId('call-view').locator('header h1').textContent())?.trim() ?? ''
  expect(fileNamePart(meeting)).not.toBe('')
  const name = download.suggestedFilename()
  expect(name).toMatch(new RegExp(`^blinq-${fileNamePart(meeting)}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.(webm|mp4)$`))
  expect(name).not.toContain(room.slug)
  const file = testInfo.outputPath(name)
  await download.saveAs(file)
  const info = await probe(file)
  expect(info.streams.some((stream) => stream.codec_type === 'video')).toBe(true)
  expect(info.streams.some((stream) => stream.codec_type === 'audio')).toBe(true)

  expect(uploads).toEqual([])
  // The server keeps only the row (for the indicator and the audit log), without a file.
  const row = await getRecording(host.account, id)
  expect(row).toMatchObject({ mode: 'local', status: 'ready', sizeBytes: null })
})
