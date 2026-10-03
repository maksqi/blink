import { expect, micButton, openPanel, test, toastWith, viewOf } from './helpers'

// Stage 06 DoD: the hand queue is ordered by raise time on every client, and "Allow to speak" (give voice, lower the
// hand, ask to unmute) lets a participant without a microphone unmute after their own click, while self-unmute is off
// for the room (the per-person grant overrides the room policy).

test('three raised hands keep their order; allow to speak lets the participant unmute', async ({ collab }) => {
  test.setTimeout(120_000)
  const { room, call: host } = await collab.meeting({ waitingRoom: false, allowSelfUnmute: false }, { camera: false })
  const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
  const ben = await collab.addGuest(room, host, { name: 'Ben Guest', camera: false })
  const cleo = await collab.addUser(room, host, { name: 'Cleo Park', camera: false })

  // Self-unmute is off: participants have no microphone.
  for (const peer of [ana, ben, cleo]) await expect(micButton(peer.page)).toHaveAttribute('aria-disabled', 'true')

  const order = [ben, cleo, ana]
  for (const peer of order) {
    await peer.page.locator('[data-control="raise-hand"]').click()
    await expect.poll(async () => (await viewOf(host.page, peer.identity))?.handRaisedAt).not.toBeNull()
    await expect(peer.page.locator('[data-control="raise-hand"]')).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(toastWith(host.page, /raised their hand/)).toBeVisible()

  await openPanel(host.page, 'participants')
  const queue = host.page.getByTestId('hand-queue-entry')
  await expect(queue).toHaveCount(3)
  expect(await queue.evaluateAll((items) => items.map((item) => item.getAttribute('data-identity')))).toEqual(
    order.map((peer) => peer.identity),
  )
  // Every client shows the same queue; a participant sees their own position.
  await openPanel(ana.page, 'participants')
  await expect(ana.page.getByTestId('hand-queue-entry')).toHaveCount(3)
  expect(
    await ana.page
      .getByTestId('hand-queue-entry')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-identity'))),
  ).toEqual(order.map((peer) => peer.identity))
  await expect(ana.page.getByTestId('own-hand-position')).toContainText('number 3')
  await expect(ana.page.getByTestId('hand-allow')).toHaveCount(0)

  // Allow Cleo (second in line) to speak.
  await host.page
    .locator(`[data-testid="hand-queue-entry"][data-identity="${cleo.identity}"]`)
    .getByTestId('hand-allow')
    .click()
  const prompt = cleo.page.getByTestId('ask-unmute-dialog')
  await expect(prompt).toBeVisible()
  await expect(queue).toHaveCount(2)
  await expect(ana.page.getByTestId('own-hand-position')).toContainText('number 2')
  // Nothing is forced: the microphone stays off until Cleo clicks.
  expect((await viewOf(host.page, cleo.identity))?.micEnabled).toBe(false)
  await cleo.page.getByTestId('ask-unmute-accept').click()
  await expect.poll(async () => (await viewOf(host.page, cleo.identity))?.micEnabled).toBe(true)
  await expect.poll(async () => (await viewOf(ben.page, cleo.identity))?.micEnabled).toBe(true)
  await expect(micButton(cleo.page)).toHaveAttribute('aria-pressed', 'true')
  // The others still have no microphone.
  await expect(micButton(ana.page)).toHaveAttribute('aria-disabled', 'true')

  // A participant lowers their own hand.
  await ana.page.locator('[data-control="raise-hand"]').click()
  await expect(queue).toHaveCount(1)
})
