import { expect, test } from '../fixtures'
import { mediaState } from '../fixtures/media'

// Stage 07 DoD: the real RNNoise worklet (vendored wasm) lowers seeded white noise at -30 dBFS RMS by at least 10 dB,
// measured over 1.0-5.0 s of an OfflineAudioContext(1, 240000, 48000) render (the first second is warm-up).
const MIN_REDUCTION_DB = 10

test.describe('RNNoise', () => {
  test('lowers seeded white noise by at least 10 dB offline', async ({ joinAs, page }) => {
    await joinAs('host', { name: 'Hana Host', page, join: false })
    const support = await mediaState(page)
    expect(support?.rnnoiseSupport.ok, 'RNNoise is supported in this browser').toBe(true)

    const result = await page.evaluate(async () => {
      const hooks = (
        window as unknown as {
          __blinqTest: { measureNoiseSuppression(): Promise<{ inputDb: number; outputDb: number; peak: number }> }
        }
      ).__blinqTest
      return hooks.measureNoiseSuppression()
    })
    test.info().annotations.push({
      type: 'rnnoise',
      description: `input ${result.inputDb.toFixed(1)} dBFS, output ${result.outputDb.toFixed(1)} dBFS, peak ${result.peak}`,
    })

    expect(result.inputDb).toBeCloseTo(-30, 1)
    expect(Number.isFinite(result.outputDb), 'the output is not silent').toBe(true)
    expect(Number.isFinite(result.peak), 'every output sample is finite').toBe(true)
    expect(result.peak, 'the output is not all zeros').toBeGreaterThan(0)
    expect(result.inputDb - result.outputDb).toBeGreaterThanOrEqual(MIN_REDUCTION_DB)
  })
})
