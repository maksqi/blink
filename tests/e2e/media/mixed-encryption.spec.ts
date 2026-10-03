import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { callState, inboundAudio, inboundVideo, subscriptions, waitForRemoteFrames } from '../fixtures/livekit'

// F-015 (security review S-01): livekit-client keeps one decrypt flag per participant, and every TrackPublished
// overwrites it. A single publication announced as unencrypted (what a compromised SFU could claim about anyone) turned
// decryption off for the participant's encrypted tracks, which stayed subscribed while the E2EE worker passed whatever
// arrived straight to the decoder. blinq now blocks the whole participant for the rest of the call (and the patched
// worker drops undecrypted frames). The publisher here encrypts normally; only its extra track is announced as NONE.

interface MixedHooks {
  __blinqTest: {
    publishUnencryptedTrack?: () => Promise<void>
    state: { harness?: { unpublishUnencryptedTrack?: () => Promise<void> } }
  }
}

async function sources(page: Page, identity: string): Promise<string[]> {
  return (await subscriptions(page, identity)).map((entry) => entry.source).sort()
}

async function allBlocked(page: Page, identity: string): Promise<boolean> {
  const entries = await subscriptions(page, identity)
  return entries.length > 0 && entries.every((entry) => !entry.subscribed && !entry.enabled && entry.blocked)
}

async function audioElements(page: Page, identity: string): Promise<number> {
  return page.evaluate(
    (id) => document.querySelectorAll(`[data-blinq-audio] audio[data-identity="${id}"]`).length,
    identity,
  )
}

test.describe('a participant with one unencrypted publication', () => {
  test.setTimeout(90_000)

  test('is blocked entirely, encrypted tracks included, and stays blocked after it is gone', async ({ joinAs }) => {
    const host = await joinAs('host', { name: 'Hana Host' })
    const xena = await joinAs('participant', { name: 'Xena Mixed', room: host.room })
    const tile = host.page.locator(`[data-testid="participant-tile"][data-identity="${xena.identity}"]`)

    // Before: Xena's encrypted camera and microphone play as usual.
    await waitForRemoteFrames(host.page, xena.identity, 5)
    await expect.poll(() => audioElements(host.page, xena.identity)).toBe(1)
    await expect(tile).not.toHaveAttribute('data-blocked', 'true')

    await xena.page.evaluate(async () => {
      const hooks = (window as unknown as MixedHooks).__blinqTest
      if (!hooks.publishUnencryptedTrack) throw new Error('publishUnencryptedTrack is missing')
      await hooks.publishUnencryptedTrack()
    })

    // Every publication of Xena's is blocked, not only the one announced as unencrypted.
    await expect
      .poll(() => sources(host.page, xena.identity), { message: "Xena's publications reach the host's policy" })
      .toEqual(['camera', 'microphone', 'screen_share'])
    await expect.poll(() => allBlocked(host.page, xena.identity)).toBe(true)
    await expect.poll(async () => (await callState(host.page))?.blocked).toEqual([xena.identity])
    await expect(tile).toHaveAttribute('data-blocked', 'true')
    await expect(tile.locator('video')).toHaveCount(0)
    await expect(host.page.getByTestId('unencrypted-warning')).toBeVisible()
    await expect(host.page.getByTestId('e2ee-badge')).toHaveAttribute('data-state', 'blocked')
    await expect.poll(() => inboundVideo(host.page, xena.identity)).toEqual([])
    await expect.poll(() => inboundAudio(host.page, xena.identity)).toEqual([])
    await expect.poll(() => audioElements(host.page, xena.identity)).toBe(0)

    // Removing that publication does not lift the block: the SDK's decrypt flag for Xena may still be off.
    await xena.page.evaluate(async () => {
      const harness = (window as unknown as MixedHooks).__blinqTest.state.harness
      if (!harness?.unpublishUnencryptedTrack) throw new Error('unpublishUnencryptedTrack is missing')
      await harness.unpublishUnencryptedTrack()
    })
    await expect.poll(() => sources(host.page, xena.identity)).toEqual(['camera', 'microphone'])
    await host.page.waitForTimeout(2_000)
    expect(await allBlocked(host.page, xena.identity)).toBe(true)
    expect((await callState(host.page))?.blocked).toEqual([xena.identity])
    expect((await callState(host.page))?.participants.find((p) => p.identity === xena.identity)?.mediaEncrypted).toBe(
      false,
    )
    await expect(host.page.getByTestId('unencrypted-warning')).toBeVisible()
    await expect(tile).toHaveAttribute('data-blocked', 'true')
    expect(await inboundVideo(host.page, xena.identity)).toEqual([])
    expect(await inboundAudio(host.page, xena.identity)).toEqual([])
    expect(await audioElements(host.page, xena.identity)).toBe(0)
  })
})
