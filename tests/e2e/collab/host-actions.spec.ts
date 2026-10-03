import type { Page } from '@playwright/test'
import { callState, waitForPhase } from '../fixtures/livekit'
import {
  actionsMenu,
  cameraButton,
  expect,
  micButton,
  openActions,
  openHostControls,
  participantAction,
  participantRow,
  test,
  toastWith,
  viewOf,
  within1s,
} from './helpers'

// Stage 06 DoD: every host action reaches the peer within 1 s (timed from the click), a revoked microphone cannot be
// unmuted, ask-to-unmute never unmutes without the participant's click, removal shows the removed notice and the
// rotate-key prompt, and ending the meeting ends every client. Runs in Chromium and Firefox.

const field =
  (page: Page, identity: string, key: 'micEnabled' | 'cameraEnabled' | 'name' | 'role' | 'handRaisedAt') => async () =>
    (await viewOf(page, identity))?.[key]

test.describe('host actions', () => {
  test('mute a microphone and stop a camera; the participant can turn the camera back on', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima' })
    await expect.poll(field(host.page, ana.identity, 'micEnabled')).toBe(true)
    await expect.poll(field(host.page, ana.identity, 'cameraEnabled')).toBe(true)

    await openActions(host.page, ana.identity)
    await actionsMenu(host.page).locator('[data-action="mute-microphone"]').click()
    await within1s(field(host.page, ana.identity, 'micEnabled'), 'the host sees the microphone off').toBe(false)
    await expect(toastWith(ana.page, 'The host muted your microphone')).toBeVisible()
    // call-core's toggle follows the server mute, so one click turns it back on.
    await expect(micButton(ana.page)).toHaveAttribute('aria-pressed', 'false')

    await openActions(host.page, ana.identity)
    await actionsMenu(host.page).locator('[data-action="stop-camera"]').click()
    await within1s(field(host.page, ana.identity, 'cameraEnabled'), 'the host sees the camera off').toBe(false)
    await expect(toastWith(ana.page, 'The host stopped your camera')).toBeVisible()
    await expect(cameraButton(ana.page)).toHaveAttribute('aria-pressed', 'false')

    await cameraButton(ana.page).click()
    await expect.poll(field(host.page, ana.identity, 'cameraEnabled')).toBe(true)
    await micButton(ana.page).click()
    await expect.poll(field(host.page, ana.identity, 'micEnabled')).toBe(true)
  })

  test('a revoked microphone cannot be unmuted until the host gives it back', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
    const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })
    await expect.poll(field(ben.page, ana.identity, 'micEnabled')).toBe(true)

    await participantAction(host.page, ana.identity, 'revoke-microphone')
    await within1s(field(ben.page, ana.identity, 'micEnabled'), 'peers see the microphone off').toBe(false)
    await expect(toastWith(ana.page, 'The host turned off your microphone')).toBeVisible()
    await expect(micButton(ana.page)).toHaveAttribute('aria-disabled', 'true')

    // Neither the button nor the M hotkey can unmute.
    await micButton(ana.page).click({ force: true })
    await ana.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await ana.page.keyboard.press('m')
    for (let elapsed = 0; elapsed < 2_000; elapsed += 250) {
      expect((await viewOf(ben.page, ana.identity))?.micEnabled, 'the microphone stays off').toBe(false)
      expect((await callState(ana.page))?.media.micOn).toBe(false)
      await ben.page.waitForTimeout(250)
    }

    await participantAction(host.page, ana.identity, 'allow-microphone')
    await expect(toastWith(ana.page, 'You can unmute now')).toBeVisible()
    await expect(micButton(ana.page)).not.toHaveAttribute('aria-disabled', 'true')
    await micButton(ana.page).click()
    await expect.poll(field(ben.page, ana.identity, 'micEnabled')).toBe(true)
  })

  test('ask to unmute shows a prompt and changes nothing until the participant clicks', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
    await micButton(ana.page).click()
    await expect.poll(field(host.page, ana.identity, 'micEnabled')).toBe(false)

    // "Stay muted" keeps the microphone off.
    await participantAction(host.page, ana.identity, 'ask-unmute')
    const prompt = ana.page.getByTestId('ask-unmute-dialog')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('The host asks you to unmute')
    await ana.page.getByTestId('ask-unmute-stay').click()
    await expect(prompt).toBeHidden()

    // A second request: nothing changes while the prompt is open…
    await participantAction(host.page, ana.identity, 'ask-unmute')
    await expect(prompt).toBeVisible()
    await ana.page.waitForTimeout(1_500)
    expect((await viewOf(host.page, ana.identity))?.micEnabled).toBe(false)
    expect((await callState(ana.page))?.media.micOn).toBe(false)

    // …until the click.
    await ana.page.getByTestId('ask-unmute-accept').click()
    await expect(prompt).toBeHidden()
    await expect.poll(field(host.page, ana.identity, 'micEnabled')).toBe(true)
  })

  test('rename, co-host and lower hand reach every peer within 1 s', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
    const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })

    // Rename by the host.
    await participantAction(host.page, ana.identity, 'rename')
    const dialog = host.page.getByTestId('rename-dialog')
    await dialog.getByTestId('rename-input').fill('Ana Renamed')
    await dialog.getByTestId('rename-save').click()
    await within1s(field(ben.page, ana.identity, 'name'), 'the guest sees the new name').toBe('Ana Renamed')
    await expect.poll(field(ana.page, ana.identity, 'name')).toBe('Ana Renamed')
    await expect(dialog).toBeHidden()

    // Lower hand.
    await ben.page.locator('[data-control="raise-hand"]').click()
    await expect.poll(field(ana.page, ben.identity, 'handRaisedAt')).not.toBeNull()
    await expect.poll(field(host.page, ben.identity, 'handRaisedAt')).not.toBeNull()
    await participantAction(host.page, ben.identity, 'lower-hand')
    await within1s(field(ana.page, ben.identity, 'handRaisedAt'), 'peers see the hand down').toBeNull()

    // Make co-host.
    await participantAction(host.page, ana.identity, 'make-cohost')
    await within1s(field(ben.page, ana.identity, 'role'), 'the guest sees the new co-host').toBe('cohost')
    await expect(ana.page.locator('[data-control="host-controls"]')).toBeVisible()
    await expect(toastWith(ana.page, 'The host made you a co-host')).toBeVisible()
    await expect(
      ben.page.locator(`[data-testid="participant-tile"][data-identity="${ana.identity}"] [data-badge="cohost"]`),
    ).toBeVisible()

    // Own rename from the people panel.
    await ben.page.locator('button[data-panel="participants"]').click()
    await participantRow(ben.page, ben.identity).getByTestId('rename-self').click()
    await ben.page.getByTestId('rename-input').fill('Ben Renamed')
    await ben.page.getByTestId('rename-save').click()
    await within1s(field(host.page, ben.identity, 'name'), 'the host sees the new name').toBe('Ben Renamed')
  })

  test('remove shows the removed notice, prompts the host to rotate the key and blocks rejoining', async ({
    collab,
    rooms,
  }) => {
    const { room, host: hostUser, call: host } = await collab.meeting({ waitingRoom: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })

    await participantAction(host.page, ana.identity, 'remove')
    const confirm = host.page.getByTestId('remove-dialog')
    await expect(confirm).toContainText('Remove Ana Lima?')
    await expect(confirm).toContainText('They cannot rejoin this meeting.')
    await confirm.getByTestId('remove-confirm').click()

    await waitForPhase(ana.page, 'removed', 5_000)
    await expect(ana.page.getByTestId('call-end-notice-text')).toHaveText(
      'You were removed from this meeting. You cannot rejoin it.',
    )
    await expect.poll(async () => viewOf(host.page, ana.identity)).toBeUndefined()

    const reminder = toastWith(host.page, "People you remove still know this meeting's key.")
    await expect(reminder).toBeVisible()
    await expect(reminder.getByTestId('rotate-key-link')).toHaveAttribute('href', `/rooms/${room.id}`)
    await expect(reminder.getByTestId('rotate-key-link')).toHaveAttribute('rel', 'noopener noreferrer')
    await openHostControls(host.page)
    await expect(host.page.getByTestId('host-controls').getByTestId('rotate-key-reminder')).toBeVisible()

    const inviteToken = await rooms.createInvite(room, hostUser)
    const rejoin = await rooms.tryJoin(room, ana.user!, { inviteToken })
    expect(rejoin.status).toBe(403)
    expect((rejoin.body.data as { code?: string } | undefined)?.code).toBe('JOIN_REMOVED')
  })

  test('end for all ends every client', async ({ collab, guards }) => {
    // The SDK logs its data channels closing when the server deletes the room under it; that is the expected end.
    guards.allowConsoleError(/DataChannel error on \w+: User-Initiated Abort|data channel '\w+' closed unexpectedly/)
    const { room, call: host } = await collab.meeting({ waitingRoom: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
    const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })

    await openHostControls(host.page)
    await host.page.getByTestId('host-end-meeting').click()
    await expect(host.page.getByTestId('end-meeting-dialog')).toContainText('End the meeting for everyone?')
    await host.page.getByTestId('end-meeting-confirm').click()

    for (const peer of [ana, ben, host]) await waitForPhase(peer.page, 'ended', 5_000)
    await expect(ana.page.getByTestId('call-end-notice-text')).toHaveText('The host ended the meeting for everyone.')
    await expect(ben.page.getByTestId('call-end-notice')).toBeVisible()
  })
})
