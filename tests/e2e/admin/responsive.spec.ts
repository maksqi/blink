/**
 * Every admin page fits phones, tablets and desktops: no horizontal overflow at 375, 768 and 1440 px, with data in the
 * lists. The base fixture fails the test on console errors and CSP violations.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'

const WIDTHS = [375, 768, 1440]
const PAGES = [
  { path: '/admin', ready: 'stat-users' },
  { path: '/admin/users', ready: 'users-table' },
  { path: '/admin/invites', ready: 'invites-table' },
  { path: '/admin/rooms', ready: 'rooms-table' },
  { path: '/admin/settings', ready: 'settings-form' },
  { path: '/admin/audit', ready: 'audit-table' },
]

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/** Tables must fit too: a table that scrolls sideways hides its action buttons on phones. */
async function tableOverflow(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('[data-slot="table-container"]')].map((el) => el.scrollWidth - el.clientWidth),
    ),
  )
}

test.describe('admin pages', { tag: '@responsive' }, () => {
  for (const width of WIDTHS) {
    test(`have no horizontal overflow at ${width}px`, async ({ page, baseURL, rooms, secrets }) => {
      const admin = await rooms.createUser({ role: 'admin', displayName: 'Responsive Admin With A Rather Long Name' })
      // Data for every list: a room (also an audit entry) and an invite.
      await rooms.createRoom(admin, { name: 'A room with a long name to test truncation in narrow tables' })
      await rooms.useIdentity(page.context(), admin)
      const invite = await page.request.post('/api/admin/invites', {
        data: { email: `responsive-${Date.now()}@example.test` },
        headers: { origin: new URL(baseURL!).origin },
      })
      expect(invite.status()).toBe(201)
      secrets.track((await invite.json()).token, 'account invite token')

      await page.setViewportSize({ width, height: 900 })
      for (const target of PAGES) {
        await page.goto(target.path)
        await expect(page.getByTestId(target.ready).first()).toBeVisible()
        await page.waitForLoadState('networkidle')
        expect(await horizontalOverflow(page), `${target.path} at ${width}px`).toBeLessThanOrEqual(0)
        expect(await tableOverflow(page), `table on ${target.path} at ${width}px`).toBeLessThanOrEqual(0)
      }
    })
  }
})
