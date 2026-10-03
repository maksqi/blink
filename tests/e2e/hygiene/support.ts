/**
 * Helpers for the resource-hygiene specs: a host who opens their meeting from the dashboard, so every later visit of
 * `/m/<slug>` is a client-side navigation in the same document (where leaks survive).
 */
import type { Page } from '@playwright/test'
import { expect } from '../fixtures'
import type { E2eRoom, E2eUser } from '../fixtures/join'
import { openToPrejoin } from '../join/support'

/** Opens the host link once (its key goes into the host's key vault), then the dashboard with a working Join link. */
export async function dashboardWithRoom(page: Page, host: E2eUser, room: E2eRoom): Promise<void> {
  await openToPrejoin(page, room.link, 1)
  await expect
    .poll(() =>
      page.evaluate(
        ({ userId, roomId }) => (localStorage.getItem(`blinq:keys:${userId}`) ?? '').includes(roomId),
        { userId: host.id, roomId: room.id },
      ),
    )
    .toBe(true)
  await page.goto('/dashboard')
  await expect(joinLink(page, room)).toHaveAttribute('href', `/m/${room.slug}`)
}

/** The dashboard's Join link of `room`. */
export function joinLink(page: Page, room: E2eRoom) {
  return page.locator(`[data-testid="room-item"][data-slug="${room.slug}"]`).getByTestId('room-join')
}
