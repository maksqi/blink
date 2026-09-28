import { expect, test } from '../fixtures'

// A browser without encoded transforms (no E2EE) gets an explanation and never connects: there is no unencrypted
// fallback (docs/SECURITY.md §3.2). The APIs are removed before any page script runs, so this runs in every project,
// WebKit included (@ui).
test.describe('browser without E2EE support', { tag: '@ui' }, () => {
  test('sees the unsupported-browser screen and never opens a signaling connection', async ({ joinAs, page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      delete w.RTCRtpScriptTransform
      const sender = w.RTCRtpSender as { prototype?: Record<string, unknown> } | undefined
      if (sender?.prototype) delete sender.prototype.createEncodedStreams
      const receiver = w.RTCRtpReceiver as { prototype?: Record<string, unknown> } | undefined
      if (receiver?.prototype) delete receiver.prototype.createEncodedStreams
    })
    const sockets: string[] = []
    page.on('websocket', (socket) => sockets.push(new URL(socket.url()).pathname))

    await joinAs('host', { name: 'Old Browser', page, wait: false })
    await expect(page.getByTestId('unsupported-browser')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('unsupported-browser')).toContainText("This browser can't join encrypted calls")
    await expect(page.getByTestId('join-button')).toHaveCount(0)
    await page.waitForTimeout(1_000)
    expect(sockets.filter((path) => path.startsWith('/rtc'))).toEqual([])
  })
})
