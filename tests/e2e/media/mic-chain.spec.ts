import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { inboundAudio, type JoinedPeer } from '../fixtures/livekit'
import { chooseNoise, closeSettings, mediaState, openSettings, waitForMedia, waitForNoise } from '../fixtures/media'

// Stage 07 DoD: noise suppression browser → rnnoise → off → browser and the own mic gain change the mic chain without
// republishing: the microphone keeps its trackSid on both sides and the peer keeps hearing the fake tone.

/**
 * Received audio energy that means the tone arrives (F-061). A silent sender still produces comfort noise (about 4e-9),
 * which `> 0` accepted; the fake microphones deliver several tenths over a few seconds.
 */
const AUDIBLE_ENERGY = 1e-3

/** Audio energy the viewer receives from the publisher during `ms` (call-core's getStats snapshots). */
async function energyOver(viewer: JoinedPeer, publisher: JoinedPeer, ms = 2_500): Promise<number> {
  const read = async () => (await inboundAudio(viewer.page, publisher.identity))[0]?.totalAudioEnergy ?? 0
  const start = await read()
  await viewer.page.waitForTimeout(ms)
  return (await read()) - start
}

async function receivedSid(viewer: Page, publisher: JoinedPeer): Promise<string | undefined> {
  return (await inboundAudio(viewer, publisher.identity))[0]?.trackSid
}

/** Core's "Microphone volume" slider in the settings dialog (0–200 %, step 5). */
async function setGainPercent(page: Page, percent: number): Promise<void> {
  const slider = page.getByTestId('call-settings').getByRole('slider').first()
  await slider.focus()
  await page.keyboard.press('Home')
  for (let value = 0; value < percent; value += 5) await page.keyboard.press('ArrowRight')
  await waitForMedia(page, (state) => Math.round(state.gain * 100) === percent, `gain ${percent}%`, 10_000)
}

test.describe('microphone chain', () => {
  test.setTimeout(180_000)

  test('noise suppression and gain switch without republishing the microphone', async ({ joinAs }) => {
    const host = await joinAs('host', { name: 'Hana Host' })
    const peer = await joinAs('participant', { name: 'Pete Peer', room: host.room })
    await expect
      .poll(async () => (await inboundAudio(peer.page, host.identity))[0]?.totalAudioEnergy ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(AUDIBLE_ENERGY)

    const initial = await waitForNoise(host.page, 'browser')
    const micSid = initial.micTrackSid
    expect(micSid).toMatch(/^TR_/)
    expect(await receivedSid(peer.page, host)).toBe(micSid)
    expect(initial.micProcessing.noiseSuppression).toBe(true)
    const live = await energyOver(peer, host)
    expect(live, 'peer hears the fake tone with browser noise suppression').toBeGreaterThan(AUDIBLE_ENERGY)

    const expectSameSids = async (step: string) => {
      expect((await mediaState(host.page))?.micTrackSid, `local mic sid after ${step}`).toBe(micSid)
      expect(await receivedSid(peer.page, host), `peer mic sid after ${step}`).toBe(micSid)
    }

    await openSettings(host.page)

    // browser → rnnoise (the browser's own suppression is off while RNNoise runs).
    const support = (await mediaState(host.page))?.rnnoiseSupport
    if (support?.ok) {
      await chooseNoise(host.page, 'rnnoise')
      const rnnoise = await waitForNoise(host.page, 'rnnoise')
      expect(rnnoise.micProcessing.noiseSuppression).toBe(false)
      await host.page.waitForTimeout(1_000)
      await expectSameSids('rnnoise')
    } else {
      await expect(host.page.getByTestId('rnnoise-unsupported')).toHaveText(support?.reason ?? '')
      test.info().annotations.push({ type: 'rnnoise', description: support?.reason ?? 'unsupported' })
    }

    // → off: no suppression at all, the tone reaches the peer.
    await chooseNoise(host.page, 'off')
    const off = await waitForNoise(host.page, 'off')
    expect(off.micProcessing).toEqual({ noiseSuppression: false, echoCancellation: true, autoGainControl: true })
    await host.page.waitForTimeout(1_000)
    expect(await energyOver(peer, host), 'peer hears the tone with suppression off').toBeGreaterThan(live * 0.2)
    await expectSameSids('off')

    // Gain 0 in off mode silences the peer's copy; 100 % brings it back.
    await setGainPercent(host.page, 0)
    await host.page.waitForTimeout(1_000)
    expect(await energyOver(peer, host), 'peer level with gain 0').toBeLessThan(live * 0.05)
    await setGainPercent(host.page, 100)
    await host.page.waitForTimeout(1_000)
    expect(await energyOver(peer, host), 'peer level with gain 100 %').toBeGreaterThan(live * 0.2)

    // → browser again.
    await chooseNoise(host.page, 'browser')
    const browser = await waitForNoise(host.page, 'browser')
    expect(browser.micProcessing.noiseSuppression).toBe(true)
    await host.page.waitForTimeout(1_000)
    expect(await energyOver(peer, host), 'peer hears the tone with browser suppression').toBeGreaterThan(
      AUDIBLE_ENERGY,
    )
    await expectSameSids('browser')
    await closeSettings(host.page)
  })
})
