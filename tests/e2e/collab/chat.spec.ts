import { randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'
import { CHAT_MAX_LENGTH } from '#shared/schemas/livekit'
import { closePanel, dismiss, expect, openPanel, test, toggleSetting } from './helpers'

// Stage 06 DoD: chat is ciphertext on the wire and an XSS payload renders as text; unread badge; 2000-character limit;
// chat turned off by the host. Runs in Chromium and Firefox.

/**
 * Test-only wire capture (never app code): records every payload this page sends or receives on any RTCDataChannel,
 * as latin1 text, so a plaintext marker would be found byte for byte.
 */
function captureDataChannels() {
  const captured = { sent: [] as string[], received: [] as string[] }
  ;(window as unknown as { __wire: typeof captured }).__wire = captured
  const toText = (data: unknown): string | null => {
    let bytes: Uint8Array | null = null
    if (typeof data === 'string') return data
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    if (!bytes) return null
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return text
  }
  const record = (list: string[], data: unknown) => {
    const text = toText(data)
    if (text !== null) list.push(text)
  }
  const proto = RTCDataChannel.prototype
  const send = proto.send
  proto.send = function (this: RTCDataChannel, data: never) {
    record(captured.sent, data)
    return send.call(this, data)
  } as typeof proto.send
  const addEventListener = proto.addEventListener
  proto.addEventListener = function (this: RTCDataChannel, type: string, listener: unknown, options?: unknown) {
    if (type === 'message' && typeof listener === 'function') {
      const original = listener as (event: MessageEvent) => unknown
      const wrapped = function (this: RTCDataChannel, event: MessageEvent) {
        record(captured.received, event.data)
        return original.call(this, event)
      }
      return addEventListener.call(this, type, wrapped as EventListener, options as AddEventListenerOptions)
    }
    return addEventListener.call(this, type, listener as EventListener, options as AddEventListenerOptions)
  } as typeof proto.addEventListener
  const onmessage = Object.getOwnPropertyDescriptor(proto, 'onmessage')
  if (onmessage?.set && onmessage.get) {
    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      enumerable: onmessage.enumerable,
      get() {
        return onmessage.get!.call(this)
      },
      set(handler: ((event: MessageEvent) => unknown) | null) {
        onmessage.set!.call(
          this,
          handler &&
            function (this: RTCDataChannel, event: MessageEvent) {
              record(captured.received, event.data)
              return handler.call(this, event)
            },
        )
      },
    })
  }
}

async function wire(page: Page): Promise<{ sent: string[]; received: string[] }> {
  return page.evaluate(() => (window as unknown as { __wire: { sent: string[]; received: string[] } }).__wire)
}

async function send(page: Page, text: string) {
  await openPanel(page, 'chat')
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

function messages(page: Page) {
  return page.getByTestId('chat-panel').getByTestId('chat-message')
}

test.describe('chat', () => {
  test('messages are ciphertext on the wire', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
    // Ana's page records her data-channel traffic from before the app loads.
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false, init: captureDataChannels })

    const marker = `blinq-marker-${randomBytes(12).toString('hex')}`
    await send(ana.page, `secret ${marker} message`)
    await expect(messages(ana.page).last()).toContainText(marker)
    await openPanel(host.page, 'chat')
    await expect(messages(host.page).filter({ hasText: marker })).toHaveCount(1)
    await expect(messages(host.page).last()).toContainText('Ana Lima')

    const sent = await wire(ana.page)
    expect(sent.sent.length, 'Ana sent data-channel payloads').toBeGreaterThan(0)
    const all = [...sent.sent, ...sent.received]
    expect(all.join('').length).toBeGreaterThan(marker.length)
    for (const payload of all) expect(payload.includes(marker), 'plaintext marker on the wire').toBe(false)

    // Received side: a message from the host to Ana arrives through her data channels, never as plaintext.
    const reply = `blinq-reply-${randomBytes(12).toString('hex')}`
    await send(host.page, reply)
    await expect(messages(ana.page).filter({ hasText: reply })).toHaveCount(1)
    const after = await wire(ana.page)
    expect(after.received.length, 'Ana received data-channel payloads').toBeGreaterThan(0)
    for (const payload of [...after.sent, ...after.received]) expect(payload.includes(reply)).toBe(false)
  })

  test('XSS payloads render as text and only http(s) links become anchors', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
    const payloads = [
      '<img src=x onerror="window.__xss=1">',
      '<script>window.__xss=2</script>',
      'javascript:window.__xss=3',
      'https://example.com/"><img src=x onerror=window.__xss=4>',
      'see HTTPS://Example.com/path, then http://example.org.',
    ]
    for (const text of payloads) await send(ana.page, text)
    await openPanel(host.page, 'chat')
    const received = messages(host.page)
    await expect(received).toHaveCount(payloads.length)
    const texts = await received.getByTestId('chat-message-text').allTextContents()
    expect(texts).toEqual(payloads)
    expect(await host.page.getByTestId('chat-panel').locator('img, script').count()).toBe(0)
    expect(await host.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined()
    expect(await ana.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined()

    const links = host.page.getByTestId('chat-panel').getByTestId('chat-link')
    expect(await links.evaluateAll((items) => items.map((a) => (a as HTMLAnchorElement).getAttribute('href')))).toEqual(
      ['https://example.com/', 'https://example.com/path', 'http://example.org/'],
    )
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(link).toHaveAttribute('target', '_blank')
    }
  })

  test('unread badge, Enter and Shift+Enter, and the 2000-character limit', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })

    // Unread count while the panel is closed.
    await send(ana.page, 'first')
    await send(ana.page, 'second')
    const badge = host.page.locator('button[data-panel="chat"]')
    await expect(badge).toContainText('2')
    await openPanel(host.page, 'chat')
    await expect(messages(host.page)).toHaveCount(2)
    await expect(badge).not.toContainText('2')
    await closePanel(host.page, 'chat')

    // Enter sends, Shift+Enter adds a line.
    const input = ana.page.getByTestId('chat-input')
    await input.fill('line one')
    await input.press('Shift+Enter')
    await input.pressSequentially('line two')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await openPanel(host.page, 'chat')
    await expect(messages(host.page)).toHaveCount(3)
    expect(await messages(host.page).last().getByTestId('chat-message-text').textContent()).toBe('line one\nline two')

    // The input stops at 2000 characters and the counter shows it.
    await input.fill('x'.repeat(CHAT_MAX_LENGTH + 150))
    await expect(input).toHaveValue('x'.repeat(CHAT_MAX_LENGTH))
    await expect(ana.page.getByTestId('chat-counter')).toHaveText(`${CHAT_MAX_LENGTH}/${CHAT_MAX_LENGTH}`)
    await ana.page.getByTestId('chat-send').click()
    await expect(messages(host.page)).toHaveCount(4)
    expect((await messages(host.page).last().getByTestId('chat-message-text').textContent())?.length).toBe(
      CHAT_MAX_LENGTH,
    )
  })

  test('the host turns chat off for everyone', async ({ collab }) => {
    const { room, call: host } = await collab.meeting({ waitingRoom: false }, { camera: false })
    const ana = await collab.addUser(room, host, { name: 'Ana Lima', camera: false })
    await openPanel(ana.page, 'chat')
    await expect(ana.page.getByTestId('chat-input')).toBeVisible()

    await toggleSetting(host.page, 'chatEnabled')
    await expect(ana.page.getByTestId('chat-disabled')).toHaveText('The host turned off chat')
    await expect(ana.page.getByTestId('chat-input')).toHaveCount(0)
    await dismiss(host.page)
    await openPanel(host.page, 'chat')
    await expect(host.page.getByTestId('chat-disabled')).toBeVisible()

    await toggleSetting(host.page, 'chatEnabled')
    await expect(ana.page.getByTestId('chat-input')).toBeVisible()
  })
})
