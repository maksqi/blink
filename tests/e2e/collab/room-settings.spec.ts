import type { Page } from '@playwright/test'
import { expect, FAST, micButton, openHostControls, roomStateOf, test, toggleSetting, type CallPeer } from './helpers'

// Stage 06 DoD: live settings reach every peer's room state within 1 s (timed from the click), a locked room rejects
// new joins with ROOM_LOCKED, "hosts only" hides the participant's share button and self-unmute off takes the
// microphone away.

async function settingOf(page: Page, key: string): Promise<unknown> {
  return (await roomStateOf(page))?.[key]
}

/** Every peer sees `key = value` in its room state within 1 s. */
async function everyoneSees(peers: CallPeer[], key: string, value: unknown) {
  await Promise.all(
    peers.map((peer) =>
      expect
        .poll(() => settingOf(peer.page, key), { timeout: 1_000, message: `${peer.name} sees ${key}`, ...FAST })
        .toBe(value),
    ),
  )
}

test('live settings reach everyone within 1 s and take effect', async ({ collab, rooms }) => {
  test.setTimeout(90_000)
  const { room, host: hostUser, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
  const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
  const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })
  const peers = [host, ana, ben]
  for (const peer of peers) await expect.poll(() => settingOf(peer.page, 'locked')).toBe(false)

  // Lock: new joins are rejected.
  await toggleSetting(host.page, 'locked')
  await everyoneSees(peers, 'locked', true)
  await expect(host.page.getByTestId('setting-locked')).toHaveAttribute('data-state', 'checked')
  const latecomer = await rooms.createUser({ displayName: 'Late Comer' })
  const locked = await rooms.tryJoin(room, latecomer, { inviteToken: await rooms.createInvite(room, hostUser) })
  expect(locked.status).toBe(403)
  expect((locked.body.data as { code?: string } | undefined)?.code).toBe('ROOM_LOCKED')
  await toggleSetting(host.page, 'locked')
  await everyoneSees(peers, 'locked', false)

  // Waiting room.
  await toggleSetting(host.page, 'waitingRoom')
  await everyoneSees(peers, 'waitingRoom', true)

  // Screen share: hosts only hides the participant's share button.
  await expect(ana.page.locator('[data-control="screen-share"]')).toBeVisible()
  await openHostControls(host.page)
  await host.page.getByTestId('share-hosts').click()
  await everyoneSees(peers, 'screenSharePolicy', 'hosts')
  await expect(ana.page.locator('[data-control="screen-share"]')).toBeHidden()
  await expect(host.page.locator('[data-control="screen-share"]')).toBeVisible()
  await host.page.getByTestId('share-everyone').click()
  await everyoneSees(peers, 'screenSharePolicy', 'everyone')
  await expect(ana.page.locator('[data-control="screen-share"]')).toBeVisible()

  // Self-unmute off takes the microphone away from participants.
  await toggleSetting(host.page, 'allowSelfUnmute')
  await everyoneSees(peers, 'allowSelfUnmute', false)
  await expect(micButton(ana.page)).toHaveAttribute('aria-disabled', 'true')
  await expect(micButton(ben.page)).toHaveAttribute('aria-disabled', 'true')
  await expect(micButton(host.page)).not.toHaveAttribute('aria-disabled', 'true')
  await toggleSetting(host.page, 'allowSelfUnmute')
  await everyoneSees(peers, 'allowSelfUnmute', true)
  await expect(micButton(ana.page)).not.toHaveAttribute('aria-disabled', 'true')

  // Chat.
  await toggleSetting(host.page, 'chatEnabled')
  await everyoneSees(peers, 'chatEnabled', false)
})

test('mute all with prevent self-unmute', async ({ collab }) => {
  const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
  const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
  const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })
  for (const peer of [ana, ben]) await expect(micButton(peer.page)).toHaveAttribute('aria-pressed', 'true')

  await openHostControls(host.page)
  await host.page.getByTestId('host-mute-all').click()
  const dialog = host.page.getByTestId('mute-all-dialog')
  await dialog.getByTestId('mute-all-prevent').click()
  await dialog.getByTestId('mute-all-confirm').click()
  await expect(dialog).toBeHidden()

  for (const peer of [ana, ben]) {
    await expect(micButton(peer.page)).toHaveAttribute('aria-pressed', 'false')
    await expect(micButton(peer.page)).toHaveAttribute('aria-disabled', 'true')
  }
  await expect.poll(() => settingOf(ana.page, 'allowSelfUnmute')).toBe(false)
  // The host keeps the microphone.
  await expect(micButton(host.page)).toHaveAttribute('aria-pressed', 'true')
})
