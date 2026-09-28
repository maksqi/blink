/**
 * Fast-join marks (docs/TESTING.md §6.7): `blinq:join:click` → `blinq:join:connected` →
 * `blinq:join:first-remote-frame`, recorded with `performance.mark` and copied into `testHooks().metrics` (test and
 * dev builds). The first remote frame is detected with `requestVideoFrameCallback` on the first remote video element.
 */
import { testHooks } from '../contracts/test-hooks'

export const JOIN_MARKS = {
  click: 'blinq:join:click',
  connected: 'blinq:join:connected',
  firstRemoteFrame: 'blinq:join:first-remote-frame',
} as const

type JoinMark = (typeof JOIN_MARKS)[keyof typeof JOIN_MARKS]

function hasMark(name: JoinMark): boolean {
  return typeof performance !== 'undefined' && performance.getEntriesByName(name, 'mark').length > 0
}

export function markJoin(name: JoinMark): void {
  if (typeof performance === 'undefined') return
  const entry = performance.mark(name) as PerformanceMark | undefined
  const hooks = testHooks()
  if (hooks) hooks.metrics[name] = entry?.startTime ?? performance.now()
}

/** Starts a new measurement: forgets the marks of an earlier join on this page. */
export function markJoinClick(): void {
  if (typeof performance === 'undefined') return
  for (const name of Object.values(JOIN_MARKS)) performance.clearMarks(name)
  const hooks = testHooks()
  if (hooks) {
    const kept = Object.entries(hooks.metrics).filter(
      ([name]) => !(Object.values(JOIN_MARKS) as string[]).includes(name),
    )
    hooks.metrics = Object.fromEntries(kept)
  }
  markJoin(JOIN_MARKS.click)
}

export function joinClickMarked(): boolean {
  return hasMark(JOIN_MARKS.click)
}

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number }

/** Marks the first remote frame after a join click, once. */
export function watchFirstRemoteFrame(video: HTMLVideoElement): void {
  if (!hasMark(JOIN_MARKS.click) || hasMark(JOIN_MARKS.firstRemoteFrame)) return
  const done = () => {
    if (hasMark(JOIN_MARKS.click) && !hasMark(JOIN_MARKS.firstRemoteFrame)) markJoin(JOIN_MARKS.firstRemoteFrame)
  }
  const target = video as FrameCallbackVideo
  if (typeof target.requestVideoFrameCallback === 'function') target.requestVideoFrameCallback(done)
  else video.addEventListener('loadeddata', done, { once: true })
}
