import { describe, expect, it } from 'vitest'
import { buildPublishDefaults, cameraPreset, DEFAULT_MEDIA_LIMITS, screenSharePreset } from './presets'
import {
  canShareScreen,
  canSimulcastWithE2EE,
  evaluateCallSupport,
  isMobileOs,
  parseBrowser,
  type BrowserEnv,
} from './support'

const UA = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0',
  safari171:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  safari172:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  safari18:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  iphone170:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphone175:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
}

function env(overrides: Partial<BrowserEnv> = {}): BrowserEnv {
  return {
    userAgent: UA.chrome,
    maxTouchPoints: 0,
    hasRTCPeerConnection: true,
    hasInsertableStreams: true,
    hasScriptTransform: false,
    hasWorker: true,
    hasSubtleCrypto: true,
    hasGetUserMedia: true,
    hasGetDisplayMedia: true,
    ...overrides,
  }
}

describe('parseBrowser', () => {
  it('recognizes the supported engines', () => {
    expect(parseBrowser(UA.chrome)).toMatchObject({ name: 'chrome', version: [141, 0], os: 'macos' })
    expect(parseBrowser(UA.edge)).toMatchObject({ name: 'chrome', os: 'windows' })
    expect(parseBrowser(UA.firefox)).toMatchObject({ name: 'firefox', version: [146, 0], os: 'linux' })
    expect(parseBrowser(UA.safari171)).toMatchObject({ name: 'safari', version: [17, 1], os: 'macos' })
    expect(parseBrowser(UA.iphone175)).toMatchObject({ name: 'safari', os: 'ios', osVersion: [17, 5] })
    expect(parseBrowser(UA.iphoneChrome)).toMatchObject({ name: 'chrome', os: 'ios', osVersion: [16, 7] })
    expect(parseBrowser(UA.android)).toMatchObject({ name: 'chrome', os: 'android' })
  })

  it('treats a desktop-mode iPad (macOS user agent with touch) as iOS', () => {
    expect(parseBrowser(UA.ipadDesktop, 5)).toMatchObject({ os: 'ios', osVersion: [17, 1] })
    expect(parseBrowser(UA.ipadDesktop, 0)).toMatchObject({ os: 'macos' })
  })
})

describe('evaluateCallSupport', () => {
  it('accepts Chromium (insertable streams) and Firefox or Safari (script transform)', () => {
    expect(evaluateCallSupport(env())).toEqual({ ok: true })
    expect(evaluateCallSupport(env({ hasInsertableStreams: false, hasScriptTransform: true }))).toEqual({ ok: true })
  })

  it('refuses browsers without encoded transforms instead of falling back to unencrypted calls', () => {
    expect(evaluateCallSupport(env({ hasInsertableStreams: false, hasScriptTransform: false }))).toEqual({
      ok: false,
      reason: 'e2ee',
    })
    expect(evaluateCallSupport(env({ hasWorker: false }))).toEqual({ ok: false, reason: 'e2ee' })
    expect(evaluateCallSupport(env({ hasSubtleCrypto: false }))).toEqual({ ok: false, reason: 'e2ee' })
  })

  it('refuses browsers without WebRTC or camera access', () => {
    expect(evaluateCallSupport(env({ hasRTCPeerConnection: false }))).toEqual({ ok: false, reason: 'webrtc' })
    expect(evaluateCallSupport(env({ hasGetUserMedia: false }))).toEqual({ ok: false, reason: 'webrtc' })
  })
})

describe('canSimulcastWithE2EE', () => {
  it('turns simulcast off on Safari and iOS before 17.2 only', () => {
    expect(canSimulcastWithE2EE(env({ userAgent: UA.safari171 }))).toBe(false)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.safari172 }))).toBe(true)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.safari18 }))).toBe(true)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.iphone170 }))).toBe(false)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.iphone175 }))).toBe(true)
    // Chrome on iOS is WebKit too.
    expect(canSimulcastWithE2EE(env({ userAgent: UA.iphoneChrome }))).toBe(false)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 }))).toBe(false)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.chrome }))).toBe(true)
    expect(canSimulcastWithE2EE(env({ userAgent: UA.firefox }))).toBe(true)
  })
})

describe('screen share availability', () => {
  it('is hidden on iOS and Android', () => {
    expect(isMobileOs(env({ userAgent: UA.android }))).toBe(true)
    expect(isMobileOs(env({ userAgent: UA.iphone175 }))).toBe(true)
    expect(canShareScreen(env({ userAgent: UA.android }))).toBe(false)
    expect(canShareScreen(env({ userAgent: UA.iphone175 }))).toBe(false)
    expect(canShareScreen(env({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 }))).toBe(false)
  })

  it('needs getDisplayMedia on desktop', () => {
    expect(canShareScreen(env())).toBe(true)
    expect(canShareScreen(env({ userAgent: UA.firefox }))).toBe(true)
    expect(canShareScreen(env({ hasGetDisplayMedia: false }))).toBe(false)
  })
})

describe('presets', () => {
  it('caps the camera at the admin limit', () => {
    expect(cameraPreset({ ...DEFAULT_MEDIA_LIMITS, maxCameraResolution: '720p' }).resolution).toMatchObject({
      width: 1280,
      height: 720,
    })
    expect(cameraPreset({ ...DEFAULT_MEDIA_LIMITS, maxCameraResolution: '1080p' }).resolution).toMatchObject({
      width: 1920,
      height: 1080,
    })
  })

  it('picks the best screen share preset within resolution and fps limits', () => {
    const pick = (res: '720p' | '1080p', fps: number) =>
      screenSharePreset({ ...DEFAULT_MEDIA_LIMITS, maxScreenShareResolution: res, maxScreenShareFps: fps })
    expect(pick('1080p', 15)).toMatchObject({ name: 'h1080fps15', contentHint: 'detail' })
    expect(pick('1080p', 30)).toMatchObject({ name: 'h1080fps30', contentHint: 'motion' })
    expect(pick('1080p', 5)).toMatchObject({ name: 'h720fps5', contentHint: 'detail' })
    expect(pick('720p', 30)).toMatchObject({ name: 'h720fps30', contentHint: 'motion' })
    expect(pick('720p', 15)).toMatchObject({ name: 'h720fps15', contentHint: 'detail' })
    expect(pick('720p', 5)).toMatchObject({ name: 'h720fps5' })
    expect(pick('1080p', 15).preset.resolution).toMatchObject({ width: 1920, height: 1080, frameRate: 15 })
    // The default admin settings allow 1080p at 15 fps.
    expect(screenSharePreset(DEFAULT_MEDIA_LIMITS).name).toBe('h1080fps15')
  })

  it('publishes VP8 simulcast without backup codec or RED, with DTX', () => {
    const defaults = buildPublishDefaults({ limits: DEFAULT_MEDIA_LIMITS, simulcast: true })
    expect(defaults).toMatchObject({ videoCodec: 'vp8', backupCodec: false, red: false, dtx: true, simulcast: true })
    expect(defaults.videoSimulcastLayers?.map((layer) => layer.height)).toEqual([180, 360])
    expect(defaults.videoEncoding?.maxBitrate).toBe(1_700_000)
    expect(defaults.screenShareEncoding).toMatchObject({ maxBitrate: 2_500_000, maxFramerate: 15 })
    expect(buildPublishDefaults({ limits: DEFAULT_MEDIA_LIMITS, simulcast: false }).simulcast).toBe(false)
  })
})
