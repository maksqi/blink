import { expect, test } from '../fixtures'
import { callState, waitForPhase } from '../fixtures/livekit'

// Pre-join: the guest name (displayNameSchema), the recording notice and the room's mute-on-join rule.
test.describe('pre-join', () => {
  test('asks guests for a valid name before joining', async ({ joinAs }) => {
    const guest = await joinAs('participant', {
      kind: 'guest',
      join: false,
      params: { nameMode: 'guest', name: '' },
    })
    const { page } = guest
    const name = page.getByLabel('Your name')
    await expect(name).toHaveValue('')

    await page.getByTestId('join-button').click()
    await expect(page.getByText('Enter a name')).toBeVisible()
    await name.fill('   ')
    await name.press('Enter')
    await expect(page.getByText('Enter a name')).toBeVisible()
    await expect(page.getByTestId('prejoin')).toBeVisible()

    // A bidi override is stripped by the shared normalization; the rest is a valid name.
    await name.fill('Gwen \u202EGuest')
    await page.getByTestId('join-button').click()
    await waitForPhase(page, 'inCall')
  })

  test('shows the recording notice and joins muted when the room says so', async ({ joinAs }) => {
    const host = await joinAs('host', { name: 'Hana Host' })
    const guest = await joinAs('participant', {
      name: 'Gus Guest',
      room: host.room,
      join: false,
      params: { rec: '1', muteOnJoin: '1' },
    })
    const { page } = guest
    await expect(page.getByTestId('prejoin-recording')).toContainText('This meeting is being recorded')
    const mic = page.getByRole('button', { name: 'Microphone', exact: true })
    const camera = page.getByRole('button', { name: 'Camera', exact: true })
    await expect(mic).toHaveAttribute('aria-pressed', 'false')
    await expect(mic).toHaveAttribute('aria-disabled', 'true')
    await expect(camera).toHaveAttribute('aria-pressed', 'false')
    await expect(camera).toHaveAttribute('aria-disabled', 'true')

    await page.getByTestId('join-button').click()
    await waitForPhase(page, 'inCall')
    const seenByHost = async () => (await callState(host.page))?.participants.find((p) => p.identity === guest.identity)
    await expect.poll(async () => (await seenByHost())?.micEnabled).toBe(false)
    await expect.poll(async () => (await seenByHost())?.cameraEnabled).toBe(false)

    // Muting on join applies to the join only: the guest can unmute afterwards.
    await page.getByRole('button', { name: 'Microphone', exact: true }).click()
    await expect.poll(async () => (await seenByHost())?.micEnabled).toBe(true)
    await page.getByRole('button', { name: 'Camera', exact: true }).click()
    await expect.poll(async () => (await seenByHost())?.cameraEnabled).toBe(true)
  })
})
