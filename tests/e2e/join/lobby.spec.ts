import { expect, test } from '../fixtures'
import { waitForPhase } from '../fixtures/livekit'
import { leaveCalls, newWatchedContext, openToPrejoin, pressJoin, spendJoinBudget, waitingRequestId } from './support'

// Stage 04: the waiting room of `/m/<slug>` (POST /api/join → 202, the waiting-room SSE, cancel). The host acts through
// the API here (the lobby panel is Stage 06); the meeting is live because the host's own join started it.
test.describe('waiting room', () => {
  test('a guest waits, keeps the place across a reload, and joins when admitted', async ({
    browser,
    rooms,
    guards,
  }) => {
    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const room = await rooms.createRoom(host, { name: 'Office hours', waitingRoom: true })
    await rooms.join(room, host)
    const link = rooms.inviteLink(room, await rooms.createInvite(room, host))

    const context = await newWatchedContext(browser, guards)
    const guest = await context.newPage()
    await openToPrejoin(guest, link)
    await expect(guest.getByTestId('join-button')).toHaveText(/Ask to join/)
    const requestId = await waitingRequestId(guest, room.slug, () => pressJoin(guest, 'Wanda Waiting'))
    await expect(guest.getByTestId('waiting-room')).toBeVisible()
    await expect(guest.getByTestId('waiting-room')).toContainText('Office hours')

    // A reload resumes the same request (same tab key and client id); the link's fragment is long gone.
    await spendJoinBudget(2)
    await guest.reload()
    await expect(guest.getByTestId('prejoin')).toBeVisible({ timeout: 20_000 })
    expect(await waitingRequestId(guest, room.slug, () => pressJoin(guest, 'Wanda Waiting'))).toBe(requestId)
    await expect(guest.getByTestId('waiting-room')).toBeVisible()

    const lobby = await rooms.callApi(host, room, 'GET', '/lobby')
    expect((lobby.body as { items: Array<{ requestId: string; displayName: string }> }).items).toEqual([
      expect.objectContaining({ requestId, displayName: 'Wanda Waiting' }),
    ])
    const admitted = Date.now()
    await rooms.admit(room, host, requestId)
    await waitForPhase(guest, 'inCall')
    console.log(`waiting room: admit → in call ${Date.now() - admitted} ms`)

    await leaveCalls(guest)
    await context.close()
  })

  test('a guest leaves the waiting room, and a denied guest is told', async ({ browser, rooms, guards }) => {
    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const room = await rooms.createRoom(host, { name: 'Office hours', waitingRoom: true })
    await rooms.join(room, host)
    const link = rooms.inviteLink(room, await rooms.createInvite(room, host))

    const context = await newWatchedContext(browser, guards)
    const leaver = await context.newPage()
    await openToPrejoin(leaver, link)
    await waitingRequestId(leaver, room.slug, () => pressJoin(leaver, 'Lee Leaving'))
    await expect(leaver.getByTestId('waiting-room')).toBeVisible()
    await leaver.getByTestId('waiting-cancel').click()
    await expect(leaver.getByTestId('prejoin')).toBeVisible()
    await expect
      .poll(async () => ((await rooms.callApi(host, room, 'GET', '/lobby')).body as { items: unknown[] }).items)
      .toEqual([])
    await leaver.close()

    const otherContext = await newWatchedContext(browser, guards)
    const denied = await otherContext.newPage()
    await openToPrejoin(denied, link)
    const requestId = await waitingRequestId(denied, room.slug, () => pressJoin(denied, 'Dan Denied'))
    await expect(denied.getByTestId('waiting-room')).toBeVisible()
    expect((await rooms.callApi(host, room, 'POST', `/lobby/${requestId}/deny`)).status).toBe(204)
    await expect(denied.getByTestId('join-error')).toHaveAttribute('data-code', 'JOIN_DENIED')

    await context.close()
    await otherContext.close()
  })

  test('locking the meeting sends waiting people back to pre-join', async ({ browser, rooms, guards }) => {
    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const room = await rooms.createRoom(host, { name: 'Office hours', waitingRoom: true })
    await rooms.join(room, host)
    const link = rooms.inviteLink(room, await rooms.createInvite(room, host))

    const context = await newWatchedContext(browser, guards)
    const guest = await context.newPage()
    await openToPrejoin(guest, link)
    await waitingRequestId(guest, room.slug, () => pressJoin(guest, 'Liz Locked'))
    await expect(guest.getByTestId('waiting-room')).toBeVisible()

    expect((await rooms.callApi(host, room, 'PATCH', '/settings', { locked: true })).status).toBe(200)
    await expect(guest.getByTestId('prejoin')).toBeVisible()
    await expect(guest.getByTestId('prejoin-error')).toContainText('The host has locked this meeting.')
    await context.close()
  })
})
