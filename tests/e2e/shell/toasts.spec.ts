import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures'
import { spendJoinBudget } from '../join/support'

/** True when something else is painted over the centre of `target`, so a click there would not reach it. */
function isCovered(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return !(top && element.contains(top))
  })
}

// F-014: a toast started on the dashboard followed the in-app navigation into the meeting and sat on top of the
// pre-join Join button at 1280x720; hovering it to click Join paused its dismissal.
test.describe('toasts on the meeting page', () => {
  test('a room created from the dashboard opens with nothing over its Join button', async ({ page, context, rooms }) => {
    const host = await rooms.createUser({ displayName: 'Tove Toast' })
    await rooms.useIdentity(context, host)
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.goto('/dashboard')
    await page.getByTestId('new-room').click()
    const dialog = page.getByTestId('create-room-dialog')
    await dialog.getByLabel('Name').fill('Toast check')
    await spendJoinBudget(1)
    await dialog.getByTestId('create-room-submit').click()

    await expect(page).toHaveURL(/\/m\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/)
    const join = page.getByTestId('join-button')
    await expect(join).toBeVisible({ timeout: 20_000 })
    expect(await isCovered(join)).toBe(false)
    // The meeting page itself confirms the new room; no toast is carried over to it.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
})
