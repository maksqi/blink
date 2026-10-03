import type { CDPSession, Page, Route } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  downloadRecording,
  getRecording,
  probe,
  recordingState,
  startRecording,
  waitForRecording,
  type RecordingHookState,
} from '../fixtures/recording'

/**
 * Long recording (Stage 08 nightly item, docs/TESTING.md §6.8): one server recording that runs for a while and covers
 * the three things short specs cannot.
 *
 * 1. Steady state for E2E_LONG_RECORDING_MINUTES (nightly: 30; local default: 2): uploads keep up (the backlog stays
 *    under 16 MiB and at most a few chunks behind) and the recorder tab's JS heap does not grow with the duration.
 * 2. Upload backlog: chunk uploads are held for 40 s. The backlog grows, nothing is dropped or failed, and after the
 *    release it drains within 60 s.
 * 3. Partial finalize: the recorder's tab closes without stopping. The server's `recordings:finalize-stale` task
 *    (every 2 min, 30 s after the recorder left) finalizes the recording as `partial`; it is processed to `ready`, the
 *    REC indicator is gone for the others, and the file covers what was uploaded.
 *
 * The numbers (chunk cadence, upload rate, heap, main-thread load, processing time, stored size per hour) are printed
 * and attached for docs/PERFORMANCE.md §5.3. Chromium only (heap and main-thread metrics come from CDP).
 */
const MINUTES = Number(process.env.E2E_LONG_RECORDING_MINUTES) || 2
const STEADY_MS = MINUTES * 60_000
const WARMUP_MS = Math.min(60_000, STEADY_MS / 4)
const SAMPLE_MS = 10_000
const HOLD_MS = 40_000
const DRAIN_WITHIN_MS = 60_000
const MAX_STEADY_BACKLOG = 16 * 1024 * 1024
const MAX_CHUNK_LAG = 3
/** JS heap growth allowed between the end of the warm-up and the end of the run, after a forced GC. */
const MAX_HEAP_GROWTH = 32 * 1024 * 1024
/** Finalize-stale cron (2 min) + recorder-left grace (30 s) + LiveKit noticing the closed tab + processing. */
const PARTIAL_READY_WITHIN_MS = 6 * 60_000

interface Sample extends RecordingHookState {
  t: number
  heapUsed: number
}

const mib = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10

async function heapAfterGc(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')).usedSize
}

/** Main-thread busy time in seconds (CDP Performance metric `TaskDuration`). */
async function taskSeconds(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0
}

async function snapshot(page: Page, cdp: CDPSession, start: number): Promise<Sample> {
  const state = await recordingState(page)
  if (!state) throw new Error('no recording state')
  const heapUsed = (await cdp.send('Runtime.getHeapUsage')).usedSize
  return { ...state, t: Date.now() - start, heapUsed }
}

/** Counts the bytes of every chunk upload the page starts (init script; Playwright reports no size for Blob bodies). */
async function countChunkUploads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counter = window as unknown as { __blinqChunkBytes: number }
    counter.__blinqChunkBytes = 0
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (init?.method === 'PUT' && init.body instanceof Blob && /\/api\/recordings\/[^/]+\/chunks\/\d+$/.test(url)) {
        counter.__blinqChunkBytes += init.body.size
      }
      return original(input, init)
    }
  })
}

async function uploadedBytes(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __blinqChunkBytes?: number }).__blinqChunkBytes ?? 0)
}

function expectHealthy(sample: Sample, maxLag: number): void {
  const at = `at ${Math.round(sample.t / 1000)} s`
  expect(sample.phase, `still recording ${at}`).toBe('recording')
  expect(sample.error, `no recording error ${at}`).toBeNull()
  expect(sample.chunksProduced - sample.chunksAcked, `uploads keep up ${at}`).toBeLessThanOrEqual(maxLag)
}

test.describe.configure({ timeout: STEADY_MS + HOLD_MS + DRAIN_WITHIN_MS + PARTIAL_READY_WITHIN_MS + 180_000 })

test(
  'a long recording keeps up, survives an upload backlog and is finalized as partial when the recorder vanishes',
  { tag: '@nightly' },
  async ({ recordingCall, page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'heap and main-thread metrics come from CDP')
    await countChunkUploads(page)
    const { room, host } = await recordingCall.open()
    const peer = await recordingCall.join(room, host.account, { name: 'Pat Participant' })
    const cdp = await host.context.newCDPSession(host.page)
    await cdp.send('Performance.enable')

    const id = await startRecording(host.page, 'server')
    const start = Date.now()
    const samples: Sample[] = []

    // 1. Steady state.
    let heapWarm = 0
    let busyWarm = 0
    let warmAt = 0
    while (Date.now() - start < STEADY_MS) {
      await host.page.waitForTimeout(Math.min(SAMPLE_MS, STEADY_MS - (Date.now() - start)))
      const current = await snapshot(host.page, cdp, start)
      samples.push(current)
      expectHealthy(current, MAX_CHUNK_LAG)
      expect(current.backlogBytes, `backlog under ${mib(MAX_STEADY_BACKLOG)} MiB`).toBeLessThan(MAX_STEADY_BACKLOG)
      if (!heapWarm && current.t >= WARMUP_MS) {
        heapWarm = await heapAfterGc(cdp)
        busyWarm = await taskSeconds(cdp)
        warmAt = Date.now()
      }
    }
    const steady = samples[samples.length - 1]!
    expect(steady.chunksAcked, 'chunks were uploaded').toBeGreaterThan(0)
    const busyPercent = Math.round((((await taskSeconds(cdp)) - busyWarm) / ((Date.now() - warmAt) / 1000)) * 100)
    const steadyUpload = { bytes: await uploadedBytes(host.page), seconds: (Date.now() - start) / 1000 }

    // 2. Upload backlog: hold every chunk upload for 40 s, then let them through.
    const held: Route[] = []
    let holding = true
    await host.page.route('**/api/recordings/*/chunks/*', async (route) => {
      if (holding) held.push(route)
      else await route.continue()
    })
    const holdStart = Date.now()
    let peakBacklog = 0
    while (Date.now() - holdStart < HOLD_MS) {
      await host.page.waitForTimeout(5_000)
      const current = await snapshot(host.page, cdp, start)
      samples.push(current)
      expect(current.phase).toBe('recording')
      expect(current.error).toBeNull()
      peakBacklog = Math.max(peakBacklog, current.backlogBytes)
    }
    const beforeRelease = (await recordingState(host.page))!
    const heldChunks = beforeRelease.chunksProduced - beforeRelease.chunksAcked
    holding = false
    for (const route of held.splice(0)) await route.continue()
    const releasedAt = Date.now()
    await expect
      .poll(
        async () => {
          const state = (await recordingState(host.page))!
          return state.chunksProduced - state.chunksAcked
        },
        { timeout: DRAIN_WITHIN_MS, intervals: [1_000], message: 'the backlog drains' },
      )
      .toBeLessThanOrEqual(1)
    const drainMs = Date.now() - releasedAt
    await host.page.unroute('**/api/recordings/*/chunks/*')
    const drained = await snapshot(host.page, cdp, start)
    samples.push(drained)
    expectHealthy(drained, 1)
    expect(peakBacklog, 'the held uploads built a backlog').toBeGreaterThan(0)
    expect(heldChunks, 'chunks kept coming while uploads were held').toBeGreaterThanOrEqual(HOLD_MS / 20_000)

    // Memory: the heap after a GC is where it was after the warm-up.
    const heapEnd = await heapAfterGc(cdp)
    const heapGrowth = heapEnd - heapWarm

    // 3. Partial finalize: the recorder's tab disappears mid-recording.
    await expect(peer.page.getByTestId('recording-indicator')).toBeVisible()
    const beforeClose = (await recordingState(host.page))!
    const recordedSeconds = (Date.now() - start) / 1000
    await cdp.detach()
    await host.page.close()
    const closedAt = Date.now()
    const ready = await waitForRecording(host.account, id, ['ready'], PARTIAL_READY_WITHIN_MS)
    const readyMs = Date.now() - closedAt
    expect(ready.partial, 'finalized as partial').toBe(true)
    // The finalize turned the indicator off for everyone who stayed.
    await expect(peer.page.getByTestId('recording-indicator')).toBeHidden()

    const file = testInfo.outputPath('long-partial.mp4')
    await downloadRecording(host.account, id, file)
    const info = await probe(file)
    expect(info.streams.map((stream) => stream.codec_type).sort()).toEqual(['audio', 'video'])
    expect(info.durationSec).not.toBeNull()

    const summary = {
      minutes: MINUTES,
      mime: beforeClose.mime,
      chunks: { produced: beforeClose.chunksProduced, acked: beforeClose.chunksAcked, retries: beforeClose.retries },
      secondsPerChunk: Math.round((steady.t / 1000 / Math.max(1, steady.chunksProduced)) * 10) / 10,
      steadyUploadMbps: Math.round(((steadyUpload.bytes * 8) / steadyUpload.seconds / 1e6) * 100) / 100,
      maxSteadyBacklogMiB: mib(Math.max(...samples.filter((s) => s.t <= STEADY_MS).map((s) => s.backlogBytes))),
      backlog: { heldChunks, peakMiB: mib(peakBacklog), drainMs },
      heapMiB: { warm: mib(heapWarm), end: mib(heapEnd), growth: mib(heapGrowth) },
      recorderMainThreadBusyPercent: busyPercent,
      partial: {
        recordedSeconds: Math.round(recordedSeconds),
        readyAfterMs: readyMs,
        durationSec: info.durationSec,
        storedMiB: mib(ready.sizeBytes ?? 0),
        storedGbPerHour:
          Math.round(((ready.sizeBytes ?? 0) / 1e9) * (3600 / (info.durationSec ?? recordedSeconds)) * 100) / 100,
      },
    }
    console.log(`long recording ${JSON.stringify(summary)}`)
    testInfo.annotations.push({ type: 'long-recording', description: JSON.stringify(summary) })
    await testInfo.attach('long-recording.json', {
      body: JSON.stringify({ summary, samples }, null, 2),
      contentType: 'application/json',
    })
    expect(heapGrowth, `heap growth ${mib(heapGrowth)} MiB`).toBeLessThan(MAX_HEAP_GROWTH)
    // The file holds what was acknowledged: everything except the chunks in flight when the tab closed.
    expect(info.durationSec!).toBeGreaterThan(recordedSeconds - 30)
    expect(info.durationSec!).toBeLessThan(recordedSeconds + 2)
    expect((await getRecording(host.account, id))?.status).toBe('ready')
  },
)
