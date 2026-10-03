/**
 * Frame clock for the recording compositor (dedicated worker, same-origin). A worker's timers keep their rate in
 * background tabs, where requestAnimationFrame stops and main-thread timers are throttled, so the canvas keeps getting
 * frames while the recorder's tab is hidden.
 *
 * Messages in: `{ type: 'start', intervalMs }`, `{ type: 'stop' }`. Messages out: `{ type: 'tick' }`.
 */
interface ClockScope {
  onmessage: ((event: MessageEvent<ClockCommand>) => void) | null
  postMessage(message: { type: 'tick' }): void
}

type ClockCommand = { type: 'start'; intervalMs: number } | { type: 'stop' }

const scope = self as unknown as ClockScope
let timer: ReturnType<typeof setInterval> | null = null

function stop() {
  if (timer !== null) clearInterval(timer)
  timer = null
}

scope.onmessage = (event) => {
  const command = event.data
  if (command?.type === 'start') {
    stop()
    const interval = Math.min(1000, Math.max(5, Number(command.intervalMs) || 33))
    timer = setInterval(() => scope.postMessage({ type: 'tick' }), interval)
  } else if (command?.type === 'stop') {
    stop()
  }
}
