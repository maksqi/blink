import { expect, test } from '../fixtures'
import { callState, inboundAudio } from '../fixtures/livekit'

// F-060: the mic chain sends what its AudioContext renders. When the context never runs (no audio backend, as for
// Firefox in a container without sound) the published microphone was silence with no hint. The call now sends the
// raw microphone after a short wait and tells the person. Here every AudioContext of the publisher stays suspended.
test.describe('microphone without a running AudioContext', () => {
  test('is sent raw, audibly, with a notice', async ({ joinAs, page }) => {
    await page.addInitScript(() => {
      const Original = window.AudioContext
      window.AudioContext = class extends Original {
        constructor(options?: AudioContextOptions) {
          super(options)
          void super.suspend()
        }

        override resume(): Promise<void> {
          return Promise.resolve()
        }
      }
    })
    const host = await joinAs('host', { name: 'Hana Host', page, camera: false })
    const peer = await joinAs('participant', { name: 'Pete Peer', room: host.room, camera: false })

    await expect(page.getByTestId('mic-chain-notice')).toBeVisible({ timeout: 15_000 })
    expect((await callState(page)) as unknown as { micChainBypassed?: boolean }).toMatchObject({
      micChainBypassed: true,
    })
    // The peer hears the raw microphone, not the comfort noise of a silent chain (about 4e-9).
    const energy = async () => (await inboundAudio(peer.page, host.identity))[0]?.totalAudioEnergy ?? 0
    const start = await energy()
    await expect.poll(async () => (await energy()) - start, { timeout: 15_000 }).toBeGreaterThan(1e-3)
  })
})
