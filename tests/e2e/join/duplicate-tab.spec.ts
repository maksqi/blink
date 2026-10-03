import { expect, test } from '../fixtures'
import { waitForPhase } from '../fixtures/livekit'
import { leaveCalls, openToPrejoin, pressJoin, spendJoinBudget } from './support'

// Stage 04 (decision): a second tab of the same browser that opens a meeting this browser is already in offers
// "Use here"; the first tab then leaves the call (BroadcastChannel `blinq:call:<slug>`).
test.describe('duplicate tabs', () => {
  test('a second tab takes the meeting over with "Use here"', async ({ page, context, rooms }) => {
    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const room = await rooms.createRoom(host, { name: 'Two tabs', waitingRoom: false })
    await rooms.useIdentity(context, host)

    await openToPrejoin(page, room.link)
    await pressJoin(page)
    await waitForPhase(page, 'inCall')

    const second = await context.newPage()
    await spendJoinBudget(2)
    await second.goto(room.link)
    await expect(second.getByTestId('duplicate-tab')).toBeVisible({ timeout: 20_000 })
    await expect(second.getByTestId('duplicate-tab')).toContainText('Two tabs')
    await expect(second.getByTestId('prejoin')).toHaveCount(0)

    await second.getByTestId('duplicate-use-here').click()
    await expect(page.getByTestId('call-end-screen')).toHaveAttribute('data-phase', 'left')
    await expect(second.getByTestId('prejoin')).toBeVisible({ timeout: 20_000 })
    await pressJoin(second)
    await waitForPhase(second, 'inCall')

    await leaveCalls(second)
  })

  test('tabs of different meetings do not interfere', async ({ page, context, rooms }) => {
    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const first = await rooms.createRoom(host, { waitingRoom: false })
    const other = await rooms.createRoom(host, { waitingRoom: false })
    await rooms.useIdentity(context, host)

    await openToPrejoin(page, first.link)
    await pressJoin(page)
    await waitForPhase(page, 'inCall')

    const second = await context.newPage()
    await openToPrejoin(second, other.link, 1)
    await expect(second.getByTestId('duplicate-tab')).toHaveCount(0)
    await leaveCalls(page)
  })
})
