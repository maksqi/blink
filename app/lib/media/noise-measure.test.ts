import { describe, expect, it } from 'vitest'
import { MEASURE_LENGTH, MEASURE_NOISE_DB, MEASURE_SEED, mulberry32, peakOf, rmsDb, whiteNoise } from './noise-measure'

describe('mulberry32', () => {
  it('is deterministic per seed and uniform in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const values = Array.from({ length: 1000 }, () => a())
    expect(Array.from({ length: 1000 }, () => b())).toEqual(values)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(values.reduce((sum, v) => sum + v, 0) / values.length).toBeCloseTo(0.5, 1)
    expect(mulberry32(43)()).not.toBe(mulberry32(42)())
  })
})

describe('rmsDb and peakOf', () => {
  it('measures dBFS', () => {
    expect(rmsDb([1, -1, 1, -1])).toBeCloseTo(0, 6)
    expect(rmsDb([0.5, -0.5])).toBeCloseTo(-6.02, 2)
    expect(rmsDb([0, 0, 0])).toBe(Number.NEGATIVE_INFINITY)
    expect(rmsDb([1, 1, 0, 0], 2, 4)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('reports the absolute peak and NaN for non-finite output', () => {
    expect(peakOf([0.1, -0.7, 0.3])).toBeCloseTo(0.7)
    expect(peakOf([0, 0])).toBe(0)
    expect(peakOf([0.1, Number.NaN])).toBeNaN()
    expect(peakOf([0.1, Number.POSITIVE_INFINITY])).toBeNaN()
  })
})

describe('whiteNoise', () => {
  it('is seeded and scaled to the requested RMS', () => {
    const noise = whiteNoise(MEASURE_LENGTH, MEASURE_NOISE_DB, MEASURE_SEED)
    expect(noise).toHaveLength(MEASURE_LENGTH)
    expect(rmsDb(noise)).toBeCloseTo(MEASURE_NOISE_DB, 3)
    expect(whiteNoise(1000, -30, 1)).toEqual(whiteNoise(1000, -30, 1))
    // Uniform noise peaks at sqrt(3) x RMS: -30 dBFS RMS stays far from clipping.
    expect(peakOf(noise)).toBeLessThan(0.06)
  })
})
