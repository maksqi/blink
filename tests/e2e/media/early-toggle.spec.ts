import { expect, test } from '../fixtures'
import { callState, waitForPhase } from '../fixtures/livekit'

// F-059: turning the microphone off the moment the call starts, while its publish is still under way, logged
// "could not update mute status for unpublished track" (LiveKit only reports mutes of published tracks). The toggle now
// waits for the publish. The base fixture fails the test on any console error.
test.describe('media toggles right after joining', () => {
  test('a mute pressed while the microphone is being published applies without an error', async ({ joinAs }) => {
    const host = await joinAs('host', { name: 'Hana Host', camera: false })
    const ana = await joinAs('participant', { name: 'Ana Early', room: host.room, camera: false, join: false })

    // Press M as soon as the call phase is in-call: connect() publishes the microphone right after that.
    await ana.page.evaluate(() => {
      const hooks = (window as unknown as { __blinqTest: { state: { call?: { phase?: string } } } }).__blinqTest
      const timer = setInterval(() => {
        if (hooks.state.call?.phase !== 'inCall') return
        clearInterval(timer)
        for (const type of ['keydown', 'keyup']) {
          document.dispatchEvent(new KeyboardEvent(type, { key: 'm', code: 'KeyM', bubbles: true }))
        }
      }, 1)
    })
    await ana.page.getByTestId('join-button').click()
    await waitForPhase(ana.page, 'inCall')

    await expect.poll(async () => (await callState(ana.page))?.media.micOn).toBe(false)
    await expect
      .poll(async () => (await callState(host.page))?.participants.find((p) => p.identity === ana.identity)?.micEnabled)
      .toBe(false)
    // Give a late SDK error time to reach the console guard.
    await ana.page.waitForTimeout(1_000)
  })
})
