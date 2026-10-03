import { expect, test } from '../fixtures'
import { openToPrejoin, spendJoinBudget } from '../join/support'

// F-036 and F-041 (quality review): leaving the pre-join while the camera and microphone are still opening must not
// leave them running (the camera light stayed on), and the abandoned session must not start listening for device
// changes afterwards (that listener kept it alive). The browser's getUserMedia is slowed down so the devices finish
// opening after the page is gone; the navigation is client-side, so the document (and any leak) survives.

interface LateDevices {
  /** Extra milliseconds before getUserMedia resolves. */
  delay: number
  tracks: MediaStreamTrack[]
  /** devicechange listeners added without an AbortSignal and not removed yet. */
  listeners: Set<unknown>
}

test.describe('resource hygiene', () => {
  test('devices that finish opening after leaving the pre-join are stopped', async ({ page, context, rooms }) => {
    await context.addInitScript(() => {
      const state: LateDevices = { delay: 0, tracks: [], listeners: new Set() }
      ;(window as unknown as { __lateDevices: LateDevices }).__lateDevices = state
      const devices = navigator.mediaDevices
      const getUserMedia = devices.getUserMedia.bind(devices)
      devices.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints)
        state.tracks.push(...stream.getTracks())
        if (state.delay > 0) await new Promise((resolve) => setTimeout(resolve, state.delay))
        return stream
      }
      const add = devices.addEventListener.bind(devices)
      const remove = devices.removeEventListener.bind(devices)
      devices.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
        // livekit-client's own listener carries an AbortSignal (removed when its Room is collected).
        if (type === 'devicechange' && !(typeof options === 'object' && options?.signal)) state.listeners.add(listener)
        add(type, listener, options)
      }) as typeof devices.addEventListener
      devices.removeEventListener = ((type: string, listener: EventListener, options?: EventListenerOptions) => {
        if (type === 'devicechange') state.listeners.delete(listener)
        remove(type, listener, options)
      }) as typeof devices.removeEventListener
    })

    const host = await rooms.createUser({ displayName: 'Hana Host' })
    const room = await rooms.createRoom(host, { name: 'Late devices', waitingRoom: false })
    await rooms.useIdentity(context, host)
    // The first visit with the key puts it into the host's key vault, so the dashboard can open the meeting.
    await openToPrejoin(page, room.link, 1)
    await page.goto('/dashboard')

    await page.evaluate(() => {
      ;(window as unknown as { __lateDevices: LateDevices }).__lateDevices.delay = 2_500
    })
    await spendJoinBudget(1)
    await page.locator(`[data-testid="room-item"][data-slug="${room.slug}"]`).getByTestId('room-join').click()
    await expect(page.getByTestId('prejoin')).toBeVisible({ timeout: 20_000 })
    // Leave while the camera and microphone are still opening.
    await page.evaluate(() => history.back())
    await expect(page).toHaveURL(/\/dashboard$/)

    const late = () =>
      page.evaluate(() => {
        const state = (window as unknown as { __lateDevices: LateDevices }).__lateDevices
        return {
          tracks: state.tracks.length,
          live: state.tracks.filter((track) => track.readyState === 'live').map((track) => track.kind),
          listeners: state.listeners.size,
        }
      })
    // The devices opened after the page went away...
    await expect.poll(async () => (await late()).tracks, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    // ...and were stopped right away; nobody listens for device changes any more.
    await expect.poll(async () => (await late()).live, { timeout: 5_000 }).toEqual([])
    await page.waitForTimeout(1_000)
    expect(await late()).toEqual({ tracks: expect.any(Number), live: [], listeners: 0 })
  })
})
