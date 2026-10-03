import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { callState, waitForPhase, waitForRemoteFrames } from '../fixtures/livekit'
import { leaveCalls, newWatchedContext, openToPrejoin, pressJoin } from './support'

// DoD: a guest joins via an invite within the join-time budget. Join time = Join click → first decoded remote frame
// through the real flow (POST /api/join, connect), with the host already publishing (docs/TESTING.md §6.7).
// Local: printed and attached. PR gate (CI): < 6 s. Nightly: < 3 s for this single sample.
const CLICK = 'blinq:join:click'
const FRAME = 'blinq:join:first-remote-frame'

function metrics(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (window as unknown as { __blinqTest: { metrics: Record<string, number> } }).__blinqTest.metrics,
  )
}

test.describe('guest with an invite link', () => {
  test('joins through /m/<slug> and sees the host', async ({ page, context, browser, rooms, guards }, testInfo) => {
    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const room = await rooms.createRoom(host, { name: 'Open house', waitingRoom: false })
    // The host is already in the call and publishing (harness page with a real grant).
    const hostJoin = await rooms.join(room, host)
    await rooms.useIdentity(context, host)
    await page.goto(rooms.harnessPath(room, hostJoin.grant!, 'Hana Host'))
    await page.getByTestId('join-button').click()
    await waitForPhase(page, 'inCall')

    const link = rooms.inviteLink(room, await rooms.createInvite(room, host))
    const guestContext = await newWatchedContext(browser, guards)
    const guest = await guestContext.newPage()
    await openToPrejoin(guest, link)
    await expect(guest.getByTestId('prejoin')).toContainText('Open house')
    await expect(guest.getByTestId('prejoin-preview')).toBeVisible({ timeout: 20_000 })
    await pressJoin(guest, 'Gus Guest')

    await expect
      .poll(async () => (await metrics(guest))[FRAME] ?? 0, { timeout: 20_000, message: 'first remote frame' })
      .toBeGreaterThan(0)
    const marks = await metrics(guest)
    const joinMs = marks[FRAME]! - marks[CLICK]!
    expect(joinMs).toBeGreaterThan(0)
    const summary = `guest invite join time ${Math.round(joinMs)} ms`
    console.log(summary)
    testInfo.annotations.push({ type: 'join-time', description: summary })
    await testInfo.attach('guest-invite-join-time.json', {
      body: JSON.stringify({ joinMs }, null, 2),
      contentType: 'application/json',
    })
    if (process.env.E2E_NIGHTLY === '1') expect(joinMs).toBeLessThan(3_000)
    else if (process.env.CI) expect(joinMs).toBeLessThan(6_000)

    await waitForPhase(guest, 'inCall')
    const guestState = await callState(guest)
    expect(guestState?.e2eeEnabled).toBe(true)
    await waitForRemoteFrames(page, guestState!.identity!, 5)
    // The guest reached the call as a participant of a real join row.
    expect((await rooms.callApi(host, room, 'GET', '/participants')).status).toBe(200)

    await leaveCalls(guest)
    await page.evaluate(async () => {
      const hooks = (window as unknown as { __blinqTest?: { state: { harness?: { leave?: () => Promise<void> } } } })
        .__blinqTest
      await hooks?.state.harness?.leave?.()
    })
    await guestContext.close()
  })
})
