import { expect, test } from '../fixtures'
import { inboundAudio, waitForPhase, waitForRemoteFrames } from '../fixtures/livekit'
import { mediaState } from '../fixtures/media'

// Stage 07 DoD: a browser without VideoFrame (no background processors) and without AudioWorklet (no RNNoise) shows
// both controls disabled with the reason, never loads MediaPipe or RNNoise, and still has a working call. The base
// fixture fails the test on any console error.
test.describe('media effects fallback', () => {
  test.setTimeout(120_000)

  test('disables unsupported effects with the reason and keeps the call working', async ({ joinAs, page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      delete w.VideoFrame
      delete w.AudioWorkletNode
    })
    const vendor: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/vendor/')) vendor.push(request.url())
    })

    const host = await joinAs('host', { name: 'Hana Host', page, join: false })
    const effects = page.getByTestId('prejoin-effects')
    await expect(effects.getByTestId('blur-unsupported')).toHaveText("Your browser can't blur the background")
    for (const level of ['off', 'light', 'strong']) await expect(effects.getByTestId(`blur-${level}`)).toBeDisabled()
    await expect(effects.getByTestId('rnnoise-unsupported')).toHaveText(
      "Your browser can't run enhanced noise suppression",
    )
    // Off and Browser still work; Enhanced is listed but disabled.
    await effects.getByTestId('noise-mode').click()
    await expect(page.getByRole('option', { name: 'Enhanced (RNNoise)' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('option', { name: 'Off', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    const state = await mediaState(page)
    expect(state?.blurSupport.ok).toBe(false)
    expect(state?.rnnoiseSupport.ok).toBe(false)
    expect(state?.blur).toBe('off')
    expect(state?.noise).toBe('browser')

    // The call works both ways.
    await page.getByTestId('join-button').click()
    await waitForPhase(page, 'inCall')
    const peer = await joinAs('participant', { name: 'Pete Peer', room: host.room })
    await waitForRemoteFrames(peer.page, host.identity, 10)
    await waitForRemoteFrames(page, peer.identity, 10)
    await expect
      .poll(async () => (await inboundAudio(peer.page, host.identity))[0]?.totalAudioEnergy ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0)

    // In the call the More menu entry is disabled and says why.
    await page.getByRole('button', { name: 'More options' }).click()
    const toggle = page.getByRole('menuitemcheckbox', { name: /Blur background/ })
    await expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await expect(toggle).toContainText("Your browser can't blur the background")
    await page.keyboard.press('Escape')

    expect(vendor, 'MediaPipe and RNNoise are never loaded').toEqual([])
  })
})
