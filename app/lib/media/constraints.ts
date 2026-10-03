/**
 * Microphone capture constraints per noise-suppression mode (pure). RNNoise replaces the browser's own suppression,
 * so both never run at once. Echo cancellation and automatic gain control stay on in every mode (decision): turning
 * them off causes echo for people without headphones, and the own-mic gain slider covers loudness.
 */
import type { MicProcessingConstraints } from '../contracts/call'
import type { NoiseMode } from './levels'

export function micProcessingFor(mode: NoiseMode): MicProcessingConstraints {
  return { noiseSuppression: mode === 'browser', echoCancellation: true, autoGainControl: true }
}

/** True when the mode needs the RNNoise insert in the mic chain. */
export function usesRnnoise(mode: NoiseMode): boolean {
  return mode === 'rnnoise'
}

export function sameMicProcessing(a: MicProcessingConstraints, b: MicProcessingConstraints): boolean {
  return (
    a.noiseSuppression === b.noiseSuppression &&
    a.echoCancellation === b.echoCancellation &&
    a.autoGainControl === b.autoGainControl
  )
}
