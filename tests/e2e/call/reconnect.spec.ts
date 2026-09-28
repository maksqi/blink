import { expect, test } from '../fixtures'
import { callState, waitForRemoteFrames } from '../fixtures/livekit'

// DoD: the reconnect banner appears on Reconnecting/SignalReconnecting and clears after Reconnected. The harness
// exposes the SDK's own reconnect paths (Room.simulateScenario) through the test hooks.
type Scenario = 'signal-reconnect' | 'resume-reconnect'

test.describe('reconnect', () => {
  for (const scenario of ['signal-reconnect', 'resume-reconnect'] as Scenario[]) {
    test(`the banner appears and clears (${scenario})`, async ({ joinAs }) => {
      const host = await joinAs('host', { name: 'Hana Host' })
      const peer = await joinAs('participant', { name: 'Pete Peer', room: host.room })
      await waitForRemoteFrames(host.page, peer.identity, 5)

      await host.page.evaluate(async (name) => {
        const harness = (window as unknown as { __blinqTest: { state: { harness: { simulate(s: string): Promise<void> } } } })
          .__blinqTest.state.harness
        await harness.simulate(name)
      }, scenario)

      const banner = host.page.getByTestId('reconnect-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toHaveAttribute('data-state', 'reconnected', { timeout: 30_000 })
      await expect(banner).toBeHidden({ timeout: 10_000 })

      const state = await callState(host.page)
      expect(state?.phase).toBe('inCall')
      expect(state?.phaseHistory).toContain('reconnecting')
      expect(state?.e2eeEnabled).toBe(true)
      // Media flows again, still encrypted, in both directions.
      await waitForRemoteFrames(host.page, peer.identity, 10)
      await waitForRemoteFrames(peer.page, host.identity, 10)
    })
  }
})
