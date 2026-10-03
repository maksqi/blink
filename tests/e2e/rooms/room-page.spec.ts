import { expect, test } from '../fixtures'
import { apiAs, HTTP_ERROR_CONSOLE, newWatchedContext, spendJoinBudget } from '../join/support'

// Stage 04: the room page (settings, password, invites, co-hosts, key rotation, deletion). Rooms made by the fixture
// have their key only in Node, so this browser starts without it, like a second device of the owner.
test.describe('room page', () => {
  test('the owner edits settings and the password, rotates the key and manages invites', async ({
    page,
    context,
    browser,
    rooms,
    guards,
  }) => {
    const owner = await rooms.createUser({ displayName: 'Olga Owner' })
    const room = await rooms.createRoom(owner, { name: 'Board room', waitingRoom: true })
    await rooms.useIdentity(context, owner)

    await page.goto(`/rooms/${room.id}`)
    await expect(page.getByRole('heading', { name: 'Board room' })).toBeVisible()
    // No key on this device yet: no links can be built.
    await expect(page.getByTestId('room-key-status')).toHaveAttribute('data-status', 'missing')
    await expect(page.getByTestId('room-copy-host-link')).toBeDisabled()

    // Settings: turn the waiting room off and save.
    const waiting = page.getByRole('switch', { name: 'Waiting room' })
    await expect(waiting).toHaveAttribute('aria-checked', 'true')
    await waiting.click()
    await page.getByTestId('room-settings-save').click()
    await expect(page.getByText('Settings saved')).toBeVisible()
    const saved = await apiAs(owner, 'GET', `/api/rooms/${room.id}`)
    expect((saved.body.room as { waitingRoom: boolean }).waitingRoom).toBe(false)

    // Password: set, then remove.
    await page.getByPlaceholder('New room password').fill('open-sesame')
    await page.getByTestId('room-password-save').click()
    await expect(page.getByTestId('room-password')).toContainText('This room has a password.')
    await page.getByTestId('room-password-remove').click()
    await expect(page.getByTestId('room-password-save')).toBeVisible()

    // Rotating the key puts a new key on this device; the old host link stops working.
    await page.getByTestId('rotate-key-open').click()
    await page.getByTestId('rotate-key-confirm').click()
    await expect(page.getByText('Room key rotated')).toBeVisible()
    await expect(page.getByTestId('room-key-status')).toHaveCount(0)
    await expect(page.getByTestId('room-copy-host-link')).toBeEnabled()

    // Invites: create one, see its link with the new key, revoke it.
    await page.getByTestId('invite-create').click()
    const invite = page.getByTestId('invite-item').first()
    await expect(invite).toHaveAttribute('data-state', 'active')
    const link = await invite.getByTestId('invite-link').inputValue()
    expect(link).toContain(`/m/${room.slug}#k=`)
    expect(link).not.toContain(room.key)
    await invite.getByTestId('invite-revoke').click()
    await page.getByTestId('invite-revoke-confirm').click()
    await expect(invite).toHaveAttribute('data-state', 'revoked')

    const visitor = await newWatchedContext(browser, guards)
    guards.allowConsoleError(HTTP_ERROR_CONSOLE)
    const old = await visitor.newPage()
    await spendJoinBudget(1)
    await old.goto(room.link)
    await expect(old.getByTestId('join-error')).toHaveAttribute('data-code', 'ROOM_KEY_INVALID')
    await visitor.close()
  })

  test('a co-host sees the room read-only, and the owner deletes it', async ({
    page,
    context,
    browser,
    rooms,
    guards,
  }) => {
    const owner = await rooms.createUser({ displayName: 'Olga Owner' })
    const cohost = await rooms.createUser({ displayName: 'Cora Cohost' })
    const room = await rooms.createRoom(owner, { name: 'Shared room' })
    await rooms.addCohost(room, owner, cohost)

    const cohostContext = await newWatchedContext(browser, guards)
    await rooms.useIdentity(cohostContext, cohost)
    const cohostPage = await cohostContext.newPage()
    await cohostPage.goto('/dashboard')
    const item = cohostPage.getByTestId('room-item').filter({ hasText: 'Shared room' })
    await expect(item).toContainText('Co-host')
    await item.getByTestId('room-name').click()
    await expect(cohostPage.getByText('Only the room owner can change these settings.')).toBeVisible()
    await expect(cohostPage.getByRole('switch', { name: 'Waiting room' })).toBeDisabled()
    await expect(cohostPage.getByTestId('rotate-key')).toHaveCount(0)
    await expect(cohostPage.getByTestId('delete-room')).toHaveCount(0)
    await expect(cohostPage.getByTestId('cohost-list')).toContainText('Cora Cohost')
    await cohostContext.close()

    await rooms.useIdentity(context, owner)
    await page.goto(`/rooms/${room.id}`)
    await expect(page.getByTestId('cohost-list')).toContainText('Cora Cohost')
    await page.getByTestId('delete-room-open').click()
    await page.getByTestId('delete-room-confirm').click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByTestId('rooms-empty')).toBeVisible()
    expect((await apiAs(owner, 'GET', `/api/rooms/${room.id}`)).status).toBe(404)
  })
})
