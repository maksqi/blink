import { expect, FAST, openPanel, test, toastWith, viewOf } from './helpers'

// Stage 06 DoD: a waiting person appears in the moderator's panel within 1 s of the join request; admit (the guest
// connects), deny and admit all work.

test.describe('waiting room', () => {
  test('a waiting guest appears within 1 s and the host admits them into the call', async ({ collab, rooms }) => {
    const { room, host: hostUser, call: host } = await collab.meeting({ waitingRoom: true }, { camera: false })
    await openPanel(host.page, 'lobby')
    await expect(host.page.getByTestId('lobby-panel')).toContainText('Nobody is waiting.')

    const inviteToken = await rooms.createInvite(room, hostUser)
    const started = Date.now()
    const wanda = await rooms.join(room, { guest: 'Wanda Waiting' }, { inviteToken })
    expect(wanda.status).toBe('waiting')
    const entry = host.page.locator(`[data-testid="lobby-entry"][data-request-id="${wanda.requestId}"]`)
    await expect(entry).toBeVisible({ timeout: Math.max(1, 1_000 - (Date.now() - started)) })
    await expect(entry).toContainText('Wanda Waiting')
    await expect(entry).toContainText('Guest')
    // The panel badge and an arrival toast with an Admit action.
    await expect(toastWith(host.page, 'Wanda Waiting is waiting to join')).toBeVisible()

    await entry.getByTestId('lobby-admit').click()
    const grant = await rooms.waitForAdmission(wanda)
    await expect(entry).toBeHidden()
    await expect(toastWith(host.page, 'Wanda Waiting is waiting to join')).toBeHidden()
    const guest = await collab.open(room, wanda, 'Wanda Waiting', { camera: false })
    expect(guest.identity).toBe(grant.identity)
    await expect.poll(async () => (await viewOf(host.page, grant.identity))?.name).toBe('Wanda Waiting')
  })

  test('deny turns a request away and admit all lets everyone in', async ({ collab, rooms }) => {
    const { room, host: hostUser, call: host } = await collab.meeting({ waitingRoom: true }, { camera: false })
    await openPanel(host.page, 'lobby')

    const inviteToken = await rooms.createInvite(room, hostUser)
    const dan = await rooms.join(room, { guest: 'Dan Denied' }, { inviteToken })
    const denied = host.page.locator(`[data-testid="lobby-entry"][data-request-id="${dan.requestId}"]`)
    await expect(denied).toBeVisible()
    await denied.getByTestId('lobby-deny').click()
    await expect(rooms.waitForAdmission(dan, 5_000)).rejects.toThrow(/denied/)
    await expect(denied).toBeHidden()

    const amy = await rooms.join(room, { guest: 'Amy Allin' }, { inviteToken })
    const user = await rooms.createUser({ displayName: 'Bea Allin' })
    const bea = await rooms.join(room, user, { inviteToken: await rooms.createInvite(room, hostUser) })
    const entries = host.page.getByTestId('lobby-entry')
    await expect(entries).toHaveCount(2)
    // Request order.
    expect(await entries.evaluateAll((items) => items.map((item) => item.getAttribute('data-request-id')))).toEqual([
      amy.requestId,
      bea.requestId,
    ])
    await expect(host.page.locator('button[data-panel="lobby"]')).toContainText('2')

    await host.page.getByTestId('lobby-admit-all').click()
    await expect(toastWith(host.page, 'Admitted 2 people')).toBeVisible()
    await Promise.all([rooms.waitForAdmission(amy), rooms.waitForAdmission(bea)])
    await expect.poll(async () => entries.count(), { timeout: 2_000, ...FAST }).toBe(0)
    await expect(host.page.getByTestId('lobby-panel')).toContainText('Nobody is waiting.')
  })
})
