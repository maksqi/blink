/**
 * The pre-join opens camera and microphone only after the document's `load` event (F-064). A media element that has
 * no data yet delays `load` (Firefox holds it while the mic chain's audio element waits for an audio backend that
 * never comes), and a pre-join that mounts before `load` would then keep the page loading for ever. The wait is
 * bounded, so something else holding `load` never keeps the devices off.
 */

/** Longest wait for `load` before the devices open anyway (decision). */
export const PAGE_LOAD_WAIT_MS = 5_000

export function afterPageLoad(doc: Document | undefined, timeoutMs: number = PAGE_LOAD_WAIT_MS): Promise<void> {
  const view = doc?.defaultView
  if (!doc || !view || doc.readyState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      view.removeEventListener('load', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    view.addEventListener('load', done)
  })
}
