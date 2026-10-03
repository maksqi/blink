import { expect, test } from '../fixtures'
import { leaveCall, startRecording, stopRecording, waitForRecording } from '../fixtures/recording'

// DoD (docs/stages/08-recording.md): a recording plays from the recordings pages: `/recordings` lists it and
// `/recordings/[id]` plays it (`video.readyState ≥ 2`).
test.describe.configure({ timeout: 150_000 })

test('a finished recording is listed and plays on the recordings page', async ({ recordingCall }) => {
  const { room, host } = await recordingCall.open()
  await recordingCall.join(room, host.account, { name: 'Pat Participant' })

  const id = await startRecording(host.page, 'server')
  await host.page.waitForTimeout(5000)
  await stopRecording(host.page)
  await waitForRecording(host.account, id, ['ready'])
  await leaveCall(host.page)

  await host.page.goto('/recordings')
  const row = host.page.locator(`[data-recording-id="${id}"]`)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText(room.name)
  await row.getByRole('link', { name: `Play the recording of ${room.name}` }).click()
  await expect(host.page).toHaveURL(new RegExp(`/recordings/${id}$`))

  const player = host.page.getByTestId('recording-player')
  await expect(player).toBeVisible()
  await player.evaluate((element: HTMLVideoElement) => {
    element.muted = true
    return element.play()
  })
  await expect
    .poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2)
  await expect
    .poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 20_000 })
    .toBeGreaterThan(0)
  expect(await player.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0)
})
