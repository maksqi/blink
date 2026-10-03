import type { Page } from '@playwright/test'
import {
  actionsMenu,
  closePanel,
  dismiss,
  expect,
  horizontalOverflow,
  openActions,
  openHostControls,
  openPanel,
  test,
} from './helpers'

// Stage 06 DoD: panels, menus and dialogs fit at 375, 768 and 1440 px without horizontal overflow (also in the
// mobile-chromium project through the @responsive tag).

const WIDTHS = [375, 768, 1440]

async function fits(page: Page, what: string) {
  expect(await horizontalOverflow(page), `${what}: horizontal overflow`).toBeLessThanOrEqual(0)
}

test.describe('collaboration UI fits', { tag: '@responsive' }, () => {
  for (const width of WIDTHS) {
    test(`panels, menus and dialogs at ${width}px`, async ({ collab, rooms, page }) => {
      test.setTimeout(90_000)
      const viewport = { width, height: width < 700 ? 740 : 900 }
      const {
        room,
        host: hostUser,
        call: host,
      } = await collab.meeting({ waitingRoom: true }, { camera: false, page, viewport })
      const ana = await collab.addUser(room, host, { name: 'Ana Lima With A Rather Long Display Name', camera: false })
      await rooms.join(room, { guest: 'Wanda Waiting' }, { inviteToken: await rooms.createInvite(room, hostUser) })
      await expect(page.getByTestId('control-bar')).toBeInViewport({ ratio: 1 })
      await fits(page, 'call')

      // People panel and the moderation menu.
      await openPanel(page, 'participants')
      await fits(page, 'people panel')
      await openActions(page, ana.identity)
      await expect(actionsMenu(page)).toBeInViewport({ ratio: 1 })
      await fits(page, 'moderation menu')
      await actionsMenu(page).locator('[data-action="remove"]').click()
      await expect(page.getByTestId('remove-dialog')).toBeInViewport({ ratio: 1 })
      await fits(page, 'remove dialog')
      await dismiss(page)
      await closePanel(page, 'participants')

      // Waiting room panel.
      await openPanel(page, 'lobby')
      await expect(page.getByTestId('lobby-entry')).toHaveCount(1)
      await expect(page.getByTestId('lobby-admit')).toBeInViewport()
      await fits(page, 'waiting room panel')
      await closePanel(page, 'lobby')

      // Chat panel with a long message.
      await openPanel(page, 'chat')
      await page.getByTestId('chat-input').fill(`${'long'.repeat(120)} https://example.com/${'path/'.repeat(40)}`)
      await page.getByTestId('chat-send').click()
      await expect(page.getByTestId('chat-message')).toHaveCount(1)
      await expect(page.getByTestId('chat-send')).toBeInViewport()
      await fits(page, 'chat panel')
      await closePanel(page, 'chat')

      // Host controls and their dialogs.
      await openHostControls(page)
      await expect(page.getByTestId('host-controls')).toBeInViewport({ ratio: 1 })
      await fits(page, 'host controls')
      await page.getByTestId('host-mute-all').click()
      await expect(page.getByTestId('mute-all-dialog')).toBeInViewport({ ratio: 1 })
      await fits(page, 'mute all dialog')
      await dismiss(page)
      await openHostControls(page)
      await page.getByTestId('host-end-meeting').click()
      await expect(page.getByTestId('end-meeting-dialog')).toBeInViewport({ ratio: 1 })
      await fits(page, 'end meeting dialog')
      await dismiss(page)

      // Reactions.
      const reactions = page.locator('[data-control="reactions"]')
      await reactions.scrollIntoViewIfNeeded()
      await reactions.click()
      await expect(page.getByTestId('reactions-menu')).toBeInViewport({ ratio: 1 })
      await fits(page, 'reactions')
      await dismiss(page)

      // The ask-to-unmute prompt on the participant's side.
      await ana.page.setViewportSize(viewport)
      await ana.page.locator('[data-control="microphone"] button').first().click()
      await openActions(page, ana.identity)
      await actionsMenu(page).locator('[data-action="ask-unmute"]').click()
      await expect(ana.page.getByTestId('ask-unmute-dialog')).toBeInViewport({ ratio: 1 })
      await fits(ana.page, 'ask-to-unmute prompt')
    })
  }
})
