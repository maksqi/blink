import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { getRecording, startRecording, stopRecording, waitForRecorderIdle } from '../fixtures/recording'

// DoD (docs/stages/08-recording.md): the REC indicator reaches everyone in ≤ 1 s. Times are compared as epoch
// milliseconds (`performance.timeOrigin + now`) of two pages on the same machine: the recorder's 201/204 from resource
// timing, the participant's indicator from a MutationObserver.
const LIMIT_MS = 1000

test.describe.configure({ timeout: 120_000 })

async function watchIndicator(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __recIndicator?: { shown: number | null; hidden: number | null } }
    w.__recIndicator = { shown: null, hidden: null }
    const state = w.__recIndicator
    const check = () => {
      const visible = Boolean(document.querySelector('[data-testid="recording-indicator"]'))
      const now = performance.timeOrigin + performance.now()
      if (visible && state.shown === null) state.shown = now
      if (!visible && state.shown !== null && state.hidden === null) state.hidden = now
    }
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true })
    check()
  })
}

async function indicatorTimes(page: Page): Promise<{ shown: number | null; hidden: number | null }> {
  return page.evaluate(
    () => (window as unknown as { __recIndicator: { shown: number | null; hidden: number | null } }).__recIndicator,
  )
}

/** Epoch ms when the response of the last request whose URL ends with `suffix` was received. */
async function responseTime(page: Page, suffix: string): Promise<number> {
  const value = await page.evaluate((end) => {
    const entries = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.endsWith(end)) as PerformanceResourceTiming[]
    const last = entries.at(-1)
    return last ? performance.timeOrigin + last.responseEnd : null
  }, suffix)
  expect(value, `resource timing for ${suffix}`).not.toBeNull()
  return value!
}

test('the participant sees REC within 1 s of the start and loses it within 1 s of the stop', async ({
  recordingCall,
}, testInfo) => {
  const { room, host } = await recordingCall.open()
  const peer = await recordingCall.join(room, host.account, { name: 'Pat Participant' })
  await expect(peer.page.getByTestId('recording-indicator')).toHaveCount(0)
  await expect(host.page.getByTestId('record-button')).toBeVisible()
  await watchIndicator(peer.page)

  await startRecording(host.page, 'server')
  await expect(peer.page.getByTestId('recording-indicator')).toBeVisible()
  await expect(host.page.getByTestId('recording-indicator')).toBeVisible()
  const started = await responseTime(host.page, '/recording/start')
  const { shown } = await indicatorTimes(peer.page)
  testInfo.annotations.push({ type: 'rec-shown-ms', description: String(Math.round(shown! - started)) })
  expect(shown! - started).toBeLessThanOrEqual(LIMIT_MS)

  // The disclosure says the server can decrypt server recordings.
  await peer.page.getByTestId('recording-indicator').hover()
  await expect(peer.page.getByTestId('recording-disclosure')).toContainText(
    'The recording is uploaded and stored encrypted on the server; the server and its admins can decrypt it.',
  )
  await expect(peer.page.getByTestId('recording-disclosure')).toContainText('Recording by Hana Host')
  await expect(peer.page.getByTestId('recording-announcement')).toHaveText('Hana Host started recording.')

  await host.page.waitForTimeout(2000)
  await stopRecording(host.page)
  await expect(peer.page.getByTestId('recording-indicator')).toHaveCount(0)
  const stopped = await responseTime(host.page, '/recording/stop')
  const { hidden } = await indicatorTimes(peer.page)
  testInfo.annotations.push({ type: 'rec-hidden-ms', description: String(Math.round(hidden! - stopped)) })
  expect(hidden! - stopped).toBeLessThanOrEqual(LIMIT_MS)
  await expect(peer.page.getByTestId('recording-announcement')).toHaveText('Recording stopped.')
})

test('a late joiner sees REC as soon as it is in the call, with the local-mode disclosure', async ({
  recordingCall,
}) => {
  const { room, host } = await recordingCall.open()
  await startRecording(host.page, 'local')
  const late = await recordingCall.join(room, host.account, { name: 'Lee Late' })
  await expect(late.page.getByTestId('recording-indicator')).toBeVisible({ timeout: LIMIT_MS })
  await expect(late.page.getByTestId('recording-indicator')).toHaveAttribute('data-mode', 'local')
  await late.page.getByTestId('recording-indicator').hover()
  await expect(late.page.getByTestId('recording-disclosure')).toContainText("Recording on Hana Host's device")

  const download = host.page.waitForEvent('download')
  await stopRecording(host.page)
  await download
  await expect(late.page.getByTestId('recording-indicator')).toHaveCount(0)
})

test("a co-host's stop makes the recorder stop, upload the rest and complete", async ({ recordingCall, rooms }) => {
  const { room, host } = await recordingCall.open()
  const cohostUser = await rooms.createUser({ displayName: 'Cora Cohost' })
  await rooms.addCohost(room, host.account, cohostUser)
  const cohost = await recordingCall.join(room, host.account, { user: cohostUser, name: 'Cora Cohost', invite: false })

  const id = await startRecording(host.page, 'server')
  const stopButton = cohost.page.getByTestId('record-button')
  await expect(stopButton).toHaveAttribute('aria-label', 'Stop the recording')
  await host.page.waitForTimeout(5000)

  const complete = host.page.waitForRequest((request) => request.url().endsWith(`/api/recordings/${id}/complete`))
  await stopButton.click()
  await expect(cohost.page.getByTestId('recording-indicator')).toHaveCount(0)
  const body = (await complete).postDataJSON() as { chunkCount: number; durationMs: number }
  const final = await waitForRecorderIdle(host.page)
  expect(final.error).toBeNull()
  expect(body.chunkCount).toBe(final.chunksProduced)
  expect(body.chunkCount).toBeGreaterThanOrEqual(1)
  await expect.poll(async () => (await getRecording(host.account, id))?.status).not.toBe('recording')
  await expect(host.page.getByTestId('record-button')).toHaveAttribute('data-state', 'idle')
})
