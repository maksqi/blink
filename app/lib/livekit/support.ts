/**
 * Browser capability checks for calls (pure over an injectable environment, so they are unit-tested).
 *
 * - E2EE needs WebRTC plus encoded transforms (Chromium's insertable streams or `RTCRtpScriptTransform`), a Worker
 *   and WebCrypto. Without them the call page shows the unsupported-browser screen; there is no unencrypted fallback.
 * - Safari before 17.2 (and every iOS browser before iOS 17.2) cannot simulcast under E2EE
 *   (https://bugs.webkit.org/show_bug.cgi?id=257803). The SDK only guards the deprecated `e2ee` option, so blinq
 *   turns simulcast off itself.
 * - iOS and Android browsers offer no screen capture to web pages, so the share button is hidden there.
 */

export interface BrowserEnv {
  userAgent: string
  /** navigator.maxTouchPoints (iPadOS reports a macOS user agent). */
  maxTouchPoints: number
  hasRTCPeerConnection: boolean
  /** RTCRtpSender.prototype.createEncodedStreams (Chromium). */
  hasInsertableStreams: boolean
  /** RTCRtpScriptTransform (Firefox, Safari). */
  hasScriptTransform: boolean
  hasWorker: boolean
  hasSubtleCrypto: boolean
  hasGetUserMedia: boolean
  hasGetDisplayMedia: boolean
}

export type BrowserName = 'chrome' | 'firefox' | 'safari' | 'other'
export type OsName = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other'

export interface BrowserInfo {
  name: BrowserName
  /** Major and minor version of the browser ([0, 0] when unknown). */
  version: [number, number]
  os: OsName
  /** iOS version for iOS devices ([0, 0] otherwise). */
  osVersion: [number, number]
}

export type CallSupport = { ok: true } | { ok: false; reason: 'webrtc' | 'e2ee' }

function version(match: RegExpMatchArray | null): [number, number] {
  if (!match) return [0, 0]
  return [Number(match[1] ?? 0), Number(match[2] ?? 0)]
}

function compare(a: [number, number], b: [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

export function parseBrowser(userAgent: string, maxTouchPoints = 0): BrowserInfo {
  const ua = userAgent
  let os: OsName = 'other'
  let osVersion: [number, number] = [0, 0]
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    os = 'ios'
    osVersion = version(ua.match(/OS (\d+)[._](\d+)/))
    // iPadOS in desktop mode reports the macOS user agent; its Safari version equals the iOS version.
    if (osVersion[0] === 0) osVersion = version(ua.match(/Version\/(\d+)\.(\d+)/))
  } else if (/Android/.test(ua)) os = 'android'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macos'
  else if (/Windows/.test(ua)) os = 'windows'
  else if (/Linux|X11/.test(ua)) os = 'linux'

  let name: BrowserName = 'other'
  let browserVersion: [number, number] = [0, 0]
  if (/Firefox\/|FxiOS\//.test(ua)) {
    name = 'firefox'
    browserVersion = version(ua.match(/(?:Firefox|FxiOS)\/(\d+)\.(\d+)/))
  } else if (/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua)) {
    name = 'chrome'
    browserVersion = version(ua.match(/(?:Chrome|Chromium|CriOS)\/(\d+)\.(\d+)/))
  } else if (/Safari\//.test(ua) || /AppleWebKit\//.test(ua)) {
    name = 'safari'
    browserVersion = version(ua.match(/Version\/(\d+)\.(\d+)/))
  }
  return { name, version: browserVersion, os, osVersion }
}

export function evaluateCallSupport(env: BrowserEnv): CallSupport {
  if (!env.hasRTCPeerConnection || !env.hasGetUserMedia) return { ok: false, reason: 'webrtc' }
  if (!(env.hasInsertableStreams || env.hasScriptTransform) || !env.hasWorker || !env.hasSubtleCrypto) {
    return { ok: false, reason: 'e2ee' }
  }
  return { ok: true }
}

const MIN_E2EE_SIMULCAST: [number, number] = [17, 2]

/** False on Safari < 17.2 and on iOS < 17.2 (every iOS browser is WebKit). */
export function canSimulcastWithE2EE(env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints'>): boolean {
  const info = parseBrowser(env.userAgent, env.maxTouchPoints)
  if (info.os === 'ios') return compare(info.osVersion, MIN_E2EE_SIMULCAST) >= 0
  if (info.name === 'safari') return compare(info.version, MIN_E2EE_SIMULCAST) >= 0
  return true
}

export function isMobileOs(env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints'>): boolean {
  const { os } = parseBrowser(env.userAgent, env.maxTouchPoints)
  return os === 'ios' || os === 'android'
}

/** Screen share is offered on desktop browsers with getDisplayMedia only (hidden on iOS and Android). */
export function canShareScreen(env: Pick<BrowserEnv, 'userAgent' | 'maxTouchPoints' | 'hasGetDisplayMedia'>): boolean {
  return env.hasGetDisplayMedia && !isMobileOs(env)
}

/** Reads the current browser. Call only in the browser. */
export function currentBrowserEnv(): BrowserEnv {
  const w = window as unknown as Record<string, unknown>
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    hasRTCPeerConnection: typeof w.RTCPeerConnection !== 'undefined',
    // The same checks as livekit-client's isInsertableStreamSupported() and isScriptTransformSupported(), so the gate
    // equals isE2EESupported() (plus Worker and WebCrypto); written out here so the join flow does not load the SDK.
    hasInsertableStreams:
      typeof w.RTCRtpSender !== 'undefined' &&
      typeof (w.RTCRtpSender as { prototype: Record<string, unknown> }).prototype.createEncodedStreams !== 'undefined',
    hasScriptTransform: typeof w.RTCRtpScriptTransform !== 'undefined',
    hasWorker: typeof w.Worker !== 'undefined',
    hasSubtleCrypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
    hasGetUserMedia: typeof devices?.getUserMedia === 'function',
    hasGetDisplayMedia: typeof devices?.getDisplayMedia === 'function',
  }
}
