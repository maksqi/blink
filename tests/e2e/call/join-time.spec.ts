import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { waitForPhase, waitForRemoteFrames } from '../fixtures/livekit'

// Join time = blinq:join:click → blinq:join:first-remote-frame, with the remote peer already publishing
// (docs/TESTING.md §6.7). Local: printed and attached only. PR gate (CI): < 6 s. Nightly (E2E_NIGHTLY=1): one
// discarded warm-up, then 10 warm joins; p95 by nearest rank (the slowest of 10) < 3 s.
const CLICK = 'blinq:join:click'
const FRAME = 'blinq:join:first-remote-frame'
const nightly = process.env.E2E_NIGHTLY === '1'

function metrics(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (window as unknown as { __blinqTest: { metrics: Record<string, number> } }).__blinqTest.metrics,
  )
}

async function measure(page: Page): Promise<number> {
  await expect(page.getByTestId('prejoin-preview')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('join-button').click()
  await expect
    .poll(async () => (await metrics(page))[FRAME] ?? 0, { timeout: 20_000, message: 'first remote frame' })
    .toBeGreaterThan(0)
  const marks = await metrics(page)
  const click = marks[CLICK]
  const frame = marks[FRAME]
  expect(click).toBeGreaterThan(0)
  expect(frame).toBeGreaterThan(click!)
  return frame! - click!
}

test.describe('join time', () => {
  test('click to first remote frame', async ({ joinAs, guards }, testInfo) => {
    test.setTimeout(nightly ? 300_000 : 60_000)
    // Rejoining with the same identity ten times in a row races the SFU: the SDK may log a track that arrives before
    // the (new) participant is known. Only the nightly loop does that.
    if (nightly) guards.allowConsoleError(/Tried to add a track for a participant, that's not present/)
    const host = await joinAs('host', { name: 'Hana Host' })
    const guest = await joinAs('participant', { name: 'Gus Guest', room: host.room, join: false })

    const samples: number[] = []
    samples.push(await measure(guest.page))
    await waitForPhase(guest.page, 'inCall')
    await waitForRemoteFrames(host.page, guest.identity, 5)

    if (nightly) {
      samples.length = 0 // the first join was the warm-up
      for (let i = 0; i < 10; i++) {
        // Leave gracefully, then load a fresh document (the same URL with a new fragment would only be a same-document
        // navigation).
        await guest.page.evaluate(async () => {
          const hooks = (window as unknown as { __blinqTest: { state: { harness: { leave(): Promise<void> } } } })
            .__blinqTest
          await hooks.state.harness.leave()
        })
        await guest.page.goto('about:blank')
        await guest.page.goto(guest.url)
        samples.push(await measure(guest.page))
        await waitForPhase(guest.page, 'inCall')
      }
    }

    const sorted = [...samples].sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!
    const summary = `join time ${samples.map((ms) => `${Math.round(ms)} ms`).join(', ')} (p95 ${Math.round(p95)} ms)`
    console.log(summary)
    testInfo.annotations.push({ type: 'join-time', description: summary })
    await testInfo.attach('join-time.json', {
      body: JSON.stringify({ samples, p95 }, null, 2),
      contentType: 'application/json',
    })

    if (nightly) expect(p95).toBeLessThan(3_000)
    else if (process.env.CI) expect(samples[0]).toBeLessThan(6_000)
  })
})
