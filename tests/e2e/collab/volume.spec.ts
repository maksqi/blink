import type { Page } from '@playwright/test'
import { expect, openActions, test } from './helpers'

// Stage 06 DoD: "volume for everyone" is applied by every receiver: a third peer plays the participant at the host's
// level times its own local volume (call-core's audio state in window.__blinqTest.state.audio).

interface AudioEntry {
  localVolume: number
  hostVolume: number
  elementVolume: number
  tracks: number
}

async function audioOf(page: Page, identity: string): Promise<AudioEntry | undefined> {
  return page.evaluate((id) => {
    const hooks = (window as unknown as { __blinqTest?: { state: { audio?: Record<string, AudioEntry> } } }).__blinqTest
    const entry = hooks?.state.audio?.[id]
    return entry ? { ...entry } : undefined
  }, identity)
}

test('volume for everyone at 25 % is applied by a third peer', async ({ collab }) => {
  const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
  const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
  const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })

  await expect.poll(async () => (await audioOf(ben.page, ana.identity))?.hostVolume).toBe(100)

  await openActions(host.page, ana.identity)
  const menu = host.page.getByTestId('participant-actions-menu')
  const slider = menu.getByRole('slider')
  await slider.focus()
  await host.page.keyboard.press('Home')
  for (let step = 0; step < 5; step++) await host.page.keyboard.press('ArrowRight')
  await expect(menu.getByTestId('volume-value')).toHaveText('25%')

  await expect.poll(async () => (await audioOf(ben.page, ana.identity))?.hostVolume).toBe(25)
  const entry = (await audioOf(ben.page, ana.identity))!
  expect(entry.localVolume).toBe(1)
  expect(entry.elementVolume).toBeCloseTo(0.25 * entry.localVolume, 5)

  // Every client sees the host volume on the participant (the `vol` attribute).
  await expect
    .poll(async () =>
      ana.page.evaluate((id) => {
        const hooks = (
          window as unknown as {
            __blinqTest?: { state: { call?: { participants: Array<{ identity: string; volumeForEveryone: number }> } } }
          }
        ).__blinqTest
        return hooks?.state.call?.participants.find((p) => p.identity === id)?.volumeForEveryone
      }, ana.identity),
    )
    .toBe(25)
  await host.page.keyboard.press('Escape')
})
