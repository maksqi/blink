import { existsSync, readFileSync, statSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import { e2eLogFile } from './base'

/**
 * Media fixtures (owner: media-fx, Stage 07): helpers for background blur, noise suppression and mic gain specs.
 * They drive the real controls (pre-join slot, settings section, More menu) and read `__blinqTest.state.media`,
 * which the effects feature publishes every 250 ms in test builds.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}>({})

export type BlurLevel = 'off' | 'light' | 'strong'
export type NoiseMode = 'off' | 'browser' | 'rnnoise'

export interface EffectSupportState {
  ok: boolean
  reason?: string
}

export interface MediaFxState {
  blur: BlurLevel
  noise: NoiseMode
  gain: number
  cameraTrackSid: string | null
  micTrackSid: string | null
  blurActive: boolean
  blurLoading: boolean
  blurFrames: number
  rnnoiseActive: boolean
  noiseBusy: boolean
  sampleRate: number | null
  micProcessing: { noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }
  cameraDeviceId: string | null
  micDeviceId: string | null
  blurSupport: EffectSupportState
  rnnoiseSupport: EffectSupportState
}

export const NOISE_OPTION: Record<NoiseMode, string> = {
  off: 'Off',
  browser: 'Browser',
  rnnoise: 'Enhanced (RNNoise)',
}

/** MediaPipe loads 9 MB of wasm and renders with SwiftShader in headless runs: be generous. */
export const BLUR_TIMEOUT = 45_000

export async function mediaState(page: Page): Promise<MediaFxState | undefined> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __blinqTest?: { state: Record<string, unknown> } }).__blinqTest
    const value = hooks?.state.media
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as MediaFxState)
  })
}

export async function waitForMedia(
  page: Page,
  check: (state: MediaFxState) => boolean,
  message: string,
  timeout = BLUR_TIMEOUT,
): Promise<MediaFxState> {
  let last: MediaFxState | undefined
  await expect
    .poll(
      async () => {
        last = await mediaState(page)
        return last ? check(last) : false
      },
      { timeout, message },
    )
    .toBe(true)
  return last!
}

/** Waits until the camera runs through the processor at `level` (or plain video for `off`). */
export function waitForBlur(page: Page, level: BlurLevel, timeout = BLUR_TIMEOUT): Promise<MediaFxState> {
  return waitForMedia(
    page,
    (state) => state.blur === level && (level === 'off' ? !state.blurActive : state.blurActive && !state.blurLoading),
    `blur ${level}`,
    timeout,
  )
}

/** Waits until the noise mode is applied (and RNNoise is in the chain when chosen). */
export function waitForNoise(page: Page, mode: NoiseMode, timeout = 20_000): Promise<MediaFxState> {
  return waitForMedia(
    page,
    (state) => state.noise === mode && !state.noiseBusy && state.rnnoiseActive === (mode === 'rnnoise'),
    `noise ${mode}`,
    timeout,
  )
}

/** Picks a blur level in the visible effects controls (pre-join slot or the open settings section). */
export async function chooseBlur(page: Page, level: BlurLevel): Promise<void> {
  await page.getByTestId(`blur-${level}`).click()
}

/** Picks a noise mode in the visible effects controls. */
export async function chooseNoise(page: Page, mode: NoiseMode): Promise<void> {
  await expect(page.getByTestId('noise-mode')).toBeEnabled()
  await page.getByTestId('noise-mode').click()
  await page.getByRole('option', { name: NOISE_OPTION[mode], exact: true }).click()
}

/** Opens the call settings dialog (More options → Settings). */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page.getByTestId('call-settings')).toBeVisible()
}

export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('call-settings')).toBeHidden()
}

/** Toggles "Blur background" in the More menu. */
export async function toggleBlurFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitemcheckbox', { name: /Blur background/ }).click()
}

/**
 * Records when the viewer's `<video>` for `identity`'s camera presents frames (requestVideoFrameCallback), following
 * element replacements. `frameGaps()` returns the largest gap between presented frames since `start`.
 */
export async function startFrameRecorder(page: Page, identity: string): Promise<void> {
  await page.evaluate((who) => {
    const selector = `[data-testid="participant-tile"][data-identity="${who}"][data-source="camera"] video`
    const times: number[] = []
    const w = window as unknown as { __mediaFxFrames?: { times: number[]; stop: boolean } }
    w.__mediaFxFrames = { times, stop: false }
    const arm = () => {
      if (w.__mediaFxFrames?.stop) return
      const video = document.querySelector<HTMLVideoElement>(selector)
      if (!video) {
        setTimeout(arm, 50)
        return
      }
      const onFrame = (now: number) => {
        times.push(now)
        if (w.__mediaFxFrames?.stop) return
        if (document.querySelector(selector) !== video) arm()
        else video.requestVideoFrameCallback(onFrame)
      }
      video.requestVideoFrameCallback(onFrame)
    }
    arm()
  }, identity)
}

export async function stopFrameRecorder(page: Page): Promise<{ frames: number; maxGapMs: number; spanMs: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __mediaFxFrames?: { times: number[]; stop: boolean } }
    const recorder = w.__mediaFxFrames
    if (!recorder) return { frames: 0, maxGapMs: Number.POSITIVE_INFINITY, spanMs: 0 }
    recorder.stop = true
    const times = recorder.times
    let maxGapMs = 0
    for (let i = 1; i < times.length; i++) maxGapMs = Math.max(maxGapMs, times[i]! - times[i - 1]!)
    const spanMs = times.length > 1 ? times.at(-1)! - times[0]! : 0
    return { frames: times.length, maxGapMs, spanMs }
  })
}

/** Current size of the e2e Caddy access log (scripts/e2e.sh), to read only what a test caused. */
export function caddyLogOffset(): number {
  const file = e2eLogFile('caddy.log')
  return existsSync(file) ? statSync(file).size : 0
}

/**
 * `/vendor/...` paths the e2e Caddy served since `offset`. Chromium reports AudioWorklet module fetches neither as
 * Playwright request events nor in resource timing, so the proxy log is the reliable record.
 */
export function vendorPathsServedSince(offset: number): string[] {
  const file = e2eLogFile('caddy.log')
  if (!existsSync(file)) return []
  const text = readFileSync(file).subarray(offset).toString('utf8')
  return [...text.matchAll(/"uri":"(\/vendor\/[^"?]*)/g)].map((match) => match[1]!)
}
