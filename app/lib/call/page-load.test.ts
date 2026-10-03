import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterPageLoad, PAGE_LOAD_WAIT_MS } from './page-load'

class FakeWindow extends EventTarget {}

function fakeDocument(readyState: DocumentReadyState) {
  const view = new FakeWindow()
  return { doc: { readyState, defaultView: view } as unknown as Document, view }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('afterPageLoad (F-064)', () => {
  it('resolves at once when the document already loaded (every client-side navigation)', async () => {
    const { doc } = fakeDocument('complete')
    await expect(afterPageLoad(doc)).resolves.toBeUndefined()
    await expect(afterPageLoad(undefined)).resolves.toBeUndefined()
  })

  it('waits for load while the page is still loading', async () => {
    const { doc, view } = fakeDocument('interactive')
    let done = false
    void afterPageLoad(doc).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(done).toBe(false)
    view.dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('gives up waiting after the timeout, so something else holding load never keeps the devices off', async () => {
    const { doc } = fakeDocument('loading')
    let done = false
    void afterPageLoad(doc).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})
