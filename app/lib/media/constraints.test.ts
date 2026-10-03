import { describe, expect, it } from 'vitest'
import { micProcessingFor, sameMicProcessing, usesRnnoise } from './constraints'

describe('micProcessingFor', () => {
  it('turns the browser noise suppression on only in browser mode', () => {
    expect(micProcessingFor('off')).toEqual({ noiseSuppression: false, echoCancellation: true, autoGainControl: true })
    expect(micProcessingFor('browser')).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    })
    // RNNoise replaces the browser's suppression; both never run at once.
    expect(micProcessingFor('rnnoise')).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    })
  })

  it('keeps echo cancellation and automatic gain control on in every mode', () => {
    for (const mode of ['off', 'browser', 'rnnoise'] as const) {
      expect(micProcessingFor(mode).echoCancellation).toBe(true)
      expect(micProcessingFor(mode).autoGainControl).toBe(true)
    }
  })
})

describe('usesRnnoise', () => {
  it('is true only for rnnoise', () => {
    expect(usesRnnoise('rnnoise')).toBe(true)
    expect(usesRnnoise('browser')).toBe(false)
    expect(usesRnnoise('off')).toBe(false)
  })
})

describe('sameMicProcessing', () => {
  it('compares every flag', () => {
    expect(sameMicProcessing(micProcessingFor('off'), micProcessingFor('rnnoise'))).toBe(true)
    expect(sameMicProcessing(micProcessingFor('off'), micProcessingFor('browser'))).toBe(false)
    expect(
      sameMicProcessing(micProcessingFor('browser'), { ...micProcessingFor('browser'), echoCancellation: false }),
    ).toBe(false)
    expect(
      sameMicProcessing(micProcessingFor('browser'), { ...micProcessingFor('browser'), autoGainControl: false }),
    ).toBe(false)
  })
})
