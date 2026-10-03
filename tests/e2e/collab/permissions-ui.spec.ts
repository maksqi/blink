import type { Page } from '@playwright/test'
import { dismiss, expect, menuActions, openHostControls, openPanel, participantRow, test } from './helpers'

// Stage 06 DoD (authorization matrix, UI side): participants and guests see no moderator controls; a co-host lacks
// host-only items and has no actions on the host. The server enforces the same matrix (tests/api/calls/authz).

async function expectNoModeration(page: Page) {
  await expect(page.locator('[data-control="host-controls"]')).toHaveCount(0)
  await expect(page.locator('button[data-panel="lobby"]')).toHaveCount(0)
  await openPanel(page, 'participants')
  await expect(page.getByTestId('participant-row')).toHaveCount(4)
  await expect(page.getByTestId('participant-actions')).toHaveCount(0)
  await expect(page.getByTestId('hand-allow')).toHaveCount(0)
}

test('participants and guests see no moderator controls; co-hosts lack host-only items', async ({ collab, rooms }) => {
  test.setTimeout(120_000)
  const { room, host: hostUser, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
  const cohostUser = await rooms.createUser({ displayName: 'Cora Cohost' })
  await rooms.addCohost(room, hostUser, cohostUser)
  const cohostJoin = await rooms.join(room, cohostUser)
  const cohost = await collab.open(room, cohostJoin, cohostUser.displayName, { camera: false })
  const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
  const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })

  // Participant (account) and guest: nothing to moderate, no tile menus either.
  await expectNoModeration(ana.page)
  await expectNoModeration(ben.page)
  for (const page of [ana.page, ben.page])
    await expect(page.locator('[data-testid="participant-tile"] [data-testid="participant-actions"]')).toHaveCount(0)
  // They can still rename themselves and raise a hand.
  await expect(participantRow(ana.page, ana.identity).getByTestId('rename-self')).toBeVisible()
  await expect(ben.page.locator('[data-control="raise-hand"]')).toBeVisible()

  // Co-host: lock and mute all only, the waiting room panel, no actions on the host, no co-host management.
  await openHostControls(cohost.page)
  const controls = cohost.page.getByTestId('host-controls')
  await expect(controls.getByTestId('setting-locked')).toBeVisible()
  await expect(controls.getByTestId('host-mute-all')).toBeVisible()
  for (const hostOnly of [
    'setting-waitingRoom',
    'setting-allowSelfUnmute',
    'setting-chatEnabled',
    'setting-screenSharePolicy',
    'host-end-meeting',
  ])
    await expect(controls.getByTestId(hostOnly)).toHaveCount(0)
  await dismiss(cohost.page)
  await expect(cohost.page.locator('button[data-panel="lobby"]')).toBeVisible()

  await openPanel(cohost.page, 'participants')
  await expect(participantRow(cohost.page, host.identity).getByTestId('participant-actions')).toHaveCount(0)
  const onAna = await menuActions(cohost.page, ana.identity)
  expect(onAna).toEqual(expect.arrayContaining(['mute-microphone', 'volume', 'rename', 'remove']))
  expect(onAna).not.toContain('make-cohost')
  const onGuest = await menuActions(cohost.page, ben.identity)
  expect(onGuest).not.toContain('make-cohost')
  expect(onGuest).toContain('remove')

  // Host: everything, including co-host management, but nothing on themselves.
  await openHostControls(host.page)
  for (const control of [
    'setting-locked',
    'setting-waitingRoom',
    'setting-allowSelfUnmute',
    'setting-chatEnabled',
    'setting-screenSharePolicy',
    'host-mute-all',
    'host-end-meeting',
  ])
    await expect(host.page.getByTestId('host-controls').getByTestId(control)).toBeVisible()
  await dismiss(host.page)
  await openPanel(host.page, 'participants')
  await expect(participantRow(host.page, host.identity).getByTestId('participant-actions')).toHaveCount(0)
  expect(await menuActions(host.page, ana.identity)).toContain('make-cohost')
  expect(await menuActions(host.page, cohost.identity)).toContain('remove-cohost')
})
