import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { waitForPhase } from '../fixtures/livekit'
import {
  apiAs,
  HTTP_ERROR_CONSOLE,
  joinFlow,
  leaveCalls,
  newWatchedContext,
  openToPrejoin,
  pressJoin,
  spendJoinBudget,
} from './support'

// Stage 04: every join problem ends on a clear screen (or an inline notice where Join is the retry). The browser logs
// the deliberate 4xx answers as console errors; nothing else may appear.
test.use({ allowConsoleErrors: [HTTP_ERROR_CONSOLE] })

test.describe('join errors', () => {
  test('a wrong key is rejected by the proof', async ({ page, rooms, secrets }) => {
    const host = await rooms.createUser()
    const room = await rooms.createRoom(host)
    const wrongKey = randomBytes(32).toString('base64url')
    secrets.track(wrongKey, 'wrong room key')
    await spendJoinBudget(1)
    await page.goto(`/m/${room.slug}#k=${wrongKey}`)
    await expect(page.getByTestId('join-error')).toHaveAttribute('data-code', 'ROOM_KEY_INVALID')
    await expect(page.getByTestId('join-error')).toContainText('Ask the host for a new link.')
    // Nothing about the room leaks to someone without the key.
    await expect(page.getByTestId('join-error')).not.toContainText(room.name)
  })

  test('a revoked invite is rejected', async ({ page, rooms }) => {
    const host = await rooms.createUser()
    const room = await rooms.createRoom(host)
    const token = await rooms.createInvite(room, host)
    const invites = await apiAs(host, 'GET', `/api/rooms/${room.id}/invites`)
    const invite = (invites.body.items as Array<{ id: string; token: string }>).find((item) => item.token === token)!
    expect((await apiAs(host, 'DELETE', `/api/rooms/${room.id}/invites/${invite.id}`)).status).toBe(204)

    await spendJoinBudget(1)
    await page.goto(rooms.inviteLink(room, token))
    await expect(page.getByTestId('join-error')).toHaveAttribute('data-code', 'ROOM_INVITE_INVALID')
  })

  test('a locked meeting keeps the guest on pre-join with the reason', async ({ page, rooms }) => {
    const host = await rooms.createUser()
    const room = await rooms.createRoom(host, { waitingRoom: false })
    await rooms.join(room, host)
    expect((await rooms.callApi(host, room, 'PATCH', '/settings', { locked: true })).status).toBe(200)

    await openToPrejoin(page, rooms.inviteLink(room, await rooms.createInvite(room, host)))
    await pressJoin(page, 'Lou Late')
    await expect(page.getByTestId('prejoin-error')).toContainText('The host has locked this meeting.')
    await expect(joinFlow(page)).toHaveAttribute('data-phase', 'prejoin')
  })

  test('a link without a key or with a damaged key never reaches the server', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/join/')) requests.push(request.url())
    })
    await page.goto('/m/abc-defg-hjk')
    await expect(page.getByTestId('join-error')).toHaveAttribute('data-code', 'MISSING_KEY')
    // A new document, so the fragment plugin sees the next link (same path, hash-only change otherwise).
    await page.goto('about:blank')
    await page.goto(`/m/abc-defg-hjk#k=${randomBytes(32).toString('base64url').slice(0, 30)}`)
    await expect(page.getByTestId('join-error')).toHaveAttribute('data-code', 'INVALID_LINK')
    await expect(page.getByTestId('join-error')).toContainText('Copy the whole link')
    expect(requests).toEqual([])
  })

  test('an unknown room, a missing invite and an account-only room say what to do', async ({
    page,
    browser,
    rooms,
    guards,
  }) => {
    await spendJoinBudget(3)
    await page.goto(`/m/zzz-zzzz-zzz#k=${randomBytes(32).toString('base64url')}`)
    await expect(page.getByTestId('join-error')).toHaveAttribute('data-code', 'ROOM_NOT_FOUND')

    const host = await rooms.createUser()
    const room = await rooms.createRoom(host, { allowGuests: false })
    // A host link opened by someone else: they need an invite.
    const guest = await newWatchedContext(browser, guards)
    const guestPage = await guest.newPage()
    await guestPage.goto(room.link)
    await expect(guestPage.getByTestId('join-error')).toHaveAttribute('data-code', 'ROOM_INVITE_REQUIRED')

    // A guest with an invite to an account-only room is asked to sign in, and comes back to the meeting after.
    await guestPage.goto('about:blank')
    await guestPage.goto(rooms.inviteLink(room, await rooms.createInvite(room, host)))
    await expect(guestPage.getByTestId('join-error')).toHaveAttribute('data-code', 'ROOM_GUESTS_NOT_ALLOWED')
    await guestPage.getByTestId('join-error-signin').click()
    await expect(guestPage).toHaveURL(/\/login\?/)
    expect(new URL(guestPage.url()).searchParams.get('next')).toBe(`/m/${room.slug}`)
    await guest.close()
  })

  test('a room password is asked for after pre-join, and a wrong one can be corrected', async ({
    page,
    rooms,
    secrets,
  }) => {
    const password = `pw-${randomBytes(6).toString('hex')}`
    secrets.track(password, 'room password')
    const host = await rooms.createUser()
    const room = await rooms.createRoom(host, { waitingRoom: false, password })
    await rooms.join(room, host)

    await openToPrejoin(page, rooms.inviteLink(room, await rooms.createInvite(room, host)), 1)
    await pressJoin(page, 'Pat Password')
    await expect(page.getByTestId('join-password')).toBeVisible()

    await spendJoinBudget(2)
    await page.locator('#join-password-input').fill('not-the-password')
    await page.getByTestId('join-password-submit').click()
    await expect(page.getByTestId('join-password-error')).toContainText('That password is not right.')
    await page.locator('#join-password-input').fill(password)
    await page.getByTestId('join-password-submit').click()
    await waitForPhase(page, 'inCall')
    await leaveCalls(page)
  })
})
