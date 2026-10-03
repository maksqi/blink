import { expect, test } from './helpers'

// Stage 06: a reaction shows on peers (overlay and tile badge); a burst is capped at 3 per second.

test('a reaction shows on peers and a burst is capped', async ({ collab }) => {
  const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
  const ana = await collab.addGuest(room, host, { name: 'Ana Guest', camera: false })

  await host.page.locator('[data-control="reactions"]').click()
  const menu = host.page.getByTestId('reactions-menu')
  await expect(menu).toBeVisible()
  await menu.locator('[data-reaction="party"]').click()

  const item = ana.page.locator('[data-testid="reaction-item"][data-reaction="party"]')
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('data-identity', host.identity)
  await expect(item.getByTestId('reaction-sender')).toHaveText('Hana Host')
  await expect(
    ana.page.locator(
      `[data-testid="participant-tile"][data-identity="${host.identity}"] [data-testid="tile-reaction"]`,
    ),
  ).toHaveAttribute('data-reaction', 'party')
  // The sender sees their own reaction too.
  await expect(host.page.locator('[data-testid="reaction-item"][data-reaction="party"]')).toBeVisible()
  // About 3 s later it is gone.
  await expect(item).toHaveCount(0, { timeout: 5_000 })

  // A burst of 10 clicks within a second: at most 3 are sent.
  await host.page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="reactions-menu"] [data-reaction="clap"]')
    for (let i = 0; i < 10; i++) button?.click()
  })
  const claps = ana.page.locator('[data-testid="reaction-item"][data-reaction="clap"]')
  await expect(claps.first()).toBeVisible()
  await ana.page.waitForTimeout(500)
  const count = await claps.count()
  expect(count).toBeGreaterThanOrEqual(1)
  expect(count).toBeLessThanOrEqual(3)
  await expect(host.page.getByTestId('reactions-menu')).toContainText('Slow down a little')
})
