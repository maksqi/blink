/** Effect levels shared by the media modules, the preferences and the UI. */

export const BLUR_LEVELS = ['off', 'light', 'strong'] as const
export type BlurLevel = (typeof BLUR_LEVELS)[number]
export type BlurOnLevel = Exclude<BlurLevel, 'off'>

/** Blur radius per level (decision: light 6, strong 14; the track-processors default is 10). */
export const BLUR_RADIUS: Record<BlurOnLevel, number> = { light: 6, strong: 14 }

export const BLUR_LABELS: Record<BlurLevel, string> = { off: 'Off', light: 'Light', strong: 'Strong' }

/** `browser` = the browser's own noise suppression (getUserMedia constraint); `rnnoise` = the RNNoise worklet. */
export const NOISE_MODES = ['off', 'browser', 'rnnoise'] as const
export type NoiseMode = (typeof NOISE_MODES)[number]

export const NOISE_LABELS: Record<NoiseMode, string> = {
  off: 'Off',
  browser: 'Browser',
  rnnoise: 'Enhanced (RNNoise)',
}

/** Own mic gain range of `AudioControl.setMicGain` (1 = unchanged). */
export const MIC_GAIN_MIN = 0
export const MIC_GAIN_MAX = 2

export function isBlurLevel(value: unknown): value is BlurLevel {
  return typeof value === 'string' && (BLUR_LEVELS as readonly string[]).includes(value)
}

export function isNoiseMode(value: unknown): value is NoiseMode {
  return typeof value === 'string' && (NOISE_MODES as readonly string[]).includes(value)
}
