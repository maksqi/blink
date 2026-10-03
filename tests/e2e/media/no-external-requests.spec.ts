import { expect, test } from '../fixtures'
import { waitForPhase, waitForRemoteFrames } from '../fixtures/livekit'
import {
  caddyLogOffset,
  chooseBlur,
  chooseNoise,
  mediaState,
  vendorPathsServedSince,
  waitForBlur,
  waitForNoise,
} from '../fixtures/media'

// Stage 07 DoD: every asset is self-hosted under /vendor/ (CSP connect-src 'self'). With blur and RNNoise on, the
// browser talks to the app's own origin only (HTTP and the LiveKit signaling WebSocket behind the same Caddy), plus
// blob:/data: URLs, and the MediaPipe and RNNoise files really come from /vendor/.
test.describe('media effects', () => {
  test.setTimeout(120_000)

  test('make no request to another origin', async ({ joinAs, page, baseURL }) => {
    const origin = new URL(baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:8080')
    const logOffset = caddyLogOffset()
    const urls: string[] = []
    await page.context().addInitScript(() => performance.setResourceTimingBufferSize(5_000))
    page.context().on('request', (request) => urls.push(request.url()))
    page.on('websocket', (socket) => urls.push(socket.url()))

    const host = await joinAs('host', { name: 'Hana Host', page, join: false })
    await chooseBlur(page, 'strong')
    await waitForBlur(page, 'strong')
    const rnnoise = (await mediaState(page))?.rnnoiseSupport.ok
    expect(rnnoise, 'RNNoise is supported in this browser').toBe(true)
    await chooseNoise(page, 'rnnoise')
    await waitForNoise(page, 'rnnoise')

    await page.getByTestId('join-button').click()
    await waitForPhase(page, 'inCall')
    const peer = await joinAs('participant', { name: 'Pete Peer', room: host.room })
    peer.context.on('request', (request) => urls.push(request.url()))
    await waitForRemoteFrames(peer.page, host.identity, 10)
    await waitForRemoteFrames(page, peer.identity, 10)
    await page.waitForTimeout(2_000)
    // Resource timing also lists fetches Playwright does not report as request events.
    for (const viewer of [page, peer.page]) {
      urls.push(...(await viewer.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))))
    }

    const foreign = urls.filter((raw) => {
      const url = new URL(raw)
      if (url.protocol === 'blob:' || url.protocol === 'data:') return false
      const sameScheme = url.protocol.replace(/^ws/, 'http') === origin.protocol
      return !(sameScheme && url.host === origin.host)
    })
    expect(foreign, 'requests to other origins').toEqual([])

    // The effects loaded their files from /vendor/ (the proxy log also sees the AudioWorklet module fetch).
    const expected = [
      /^\/vendor\/mediapipe\/selfie_segmenter\.tflite$/,
      /^\/vendor\/mediapipe\/wasm\/vision_wasm_(nosimd_)?internal\.js$/,
      /^\/vendor\/mediapipe\/wasm\/vision_wasm_(nosimd_)?internal\.wasm$/,
      /^\/vendor\/rnnoise\/workletProcessor\.js$/,
      /^\/vendor\/rnnoise\/rnnoise(_simd)?\.wasm$/,
    ]
    await expect
      .poll(
        () => {
          const served = vendorPathsServedSince(logOffset)
          return expected.filter((pattern) => !served.some((path) => pattern.test(path))).map(String)
        },
        { message: 'vendor files missing from the e2e Caddy log', timeout: 10_000 },
      )
      .toEqual([])
  })
})
