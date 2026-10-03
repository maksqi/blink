import { describe, expect, it } from 'vitest'
import { CPU_BUDGET_RATIO, CPU_WINDOW_MS, CpuMonitor, frameBudgetMs } from './cpu-monitor'

/** Feeds frames at `fps` for `durationMs` starting at `from`; returns the times at which the monitor fired. */
function feed(monitor: CpuMonitor, from: number, durationMs: number, fps: number, ms: number): number[] {
  const fired: number[] = []
  for (let t = from; t < from + durationMs; t += 1000 / fps) {
    if (monitor.recordFrame(t, ms, fps)) fired.push(t)
  }
  return fired
}

describe('frameBudgetMs', () => {
  it('is 1000 / frame rate, with 30 fps for unknown rates', () => {
    expect(frameBudgetMs(30)).toBeCloseTo(33.33, 1)
    expect(frameBudgetMs(15)).toBeCloseTo(66.67, 1)
    expect(frameBudgetMs(undefined)).toBeCloseTo(33.33, 1)
    expect(frameBudgetMs(0)).toBeCloseTo(33.33, 1)
    expect(frameBudgetMs(Number.NaN)).toBeCloseTo(33.33, 1)
    expect(frameBudgetMs(240)).toBeCloseTo(16.67, 1)
  })
})

describe('CpuMonitor: processing time', () => {
  const threshold = CPU_BUDGET_RATIO * frameBudgetMs(30) // 26.7 ms at 30 fps

  it('stays quiet below 80 % of the frame budget', () => {
    const monitor = new CpuMonitor()
    expect(feed(monitor, 0, 60_000, 30, threshold - 1)).toEqual([])
    expect(monitor.warned).toBe(false)
  })

  it('warns once the 10 s average exceeds 80 % of the budget, and only after a full window', () => {
    const monitor = new CpuMonitor()
    const fired = feed(monitor, 0, 30_000, 30, threshold + 2)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toBeGreaterThanOrEqual(CPU_WINDOW_MS)
    expect(fired[0]).toBeLessThan(CPU_WINDOW_MS + 100)
    expect(monitor.cause).toBe('processing-time')
  })

  it('uses the camera frame rate for the budget', () => {
    // 40 ms per frame is too slow for 30 fps, fine for 15 fps (budget 66.7 ms, threshold 53.3 ms).
    expect(feed(new CpuMonitor(), 0, 20_000, 15, 40)).toEqual([])
    expect(feed(new CpuMonitor(), 0, 20_000, 30, 40)).toHaveLength(1)
  })

  it('averages over a rolling window, so a short spike does not warn', () => {
    const monitor = new CpuMonitor()
    expect(feed(monitor, 0, 9_000, 30, 10)).toEqual([])
    expect(feed(monitor, 9_000, 2_000, 30, 60)).toEqual([]) // avg over 10 s ≈ 19 ms
    expect(feed(monitor, 11_000, 20_000, 30, 10)).toEqual([])
    // A sustained slowdown pushes the rolling average over the threshold within the window.
    const fired = feed(monitor, 31_000, 10_000, 30, 60)
    expect(fired).toHaveLength(1)
    expect(fired[0]! - 31_000).toBeLessThan(CPU_WINDOW_MS)
  })

  it('fires at most once per call, even after reset()', () => {
    const monitor = new CpuMonitor()
    expect(feed(monitor, 0, 15_000, 30, 50)).toHaveLength(1)
    monitor.reset()
    expect(feed(monitor, 15_000, 30_000, 30, 50)).toEqual([])
    expect(monitor.recordQualityLimitation(50_000, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(70_000, 'cpu')).toBe(false)
    expect(monitor.warned).toBe(true)
  })

  it('restarts the window after reset() (blur turned off and on again)', () => {
    const monitor = new CpuMonitor()
    expect(feed(monitor, 0, 9_000, 30, 50)).toEqual([])
    monitor.reset()
    expect(monitor.averageMs()).toBe(0)
    expect(feed(monitor, 20_000, 9_000, 30, 50)).toEqual([])
    expect(feed(monitor, 29_000, 2_000, 30, 50)).toHaveLength(1)
  })

  it('ignores invalid samples', () => {
    const monitor = new CpuMonitor()
    expect(monitor.recordFrame(0, Number.NaN)).toBe(false)
    expect(monitor.recordFrame(0, -5)).toBe(false)
    expect(monitor.averageMs()).toBe(0)
  })
})

describe('CpuMonitor: quality limitation', () => {
  it('warns after 10 s of continuous cpu limitation', () => {
    const monitor = new CpuMonitor()
    expect(monitor.recordQualityLimitation(0, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(5_000, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(9_999, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(10_000, 'cpu')).toBe(true)
    expect(monitor.cause).toBe('quality-limitation')
    expect(monitor.recordQualityLimitation(20_000, 'cpu')).toBe(false)
  })

  it('restarts the 10 s when the limitation stops in between', () => {
    const monitor = new CpuMonitor()
    monitor.recordQualityLimitation(0, 'cpu')
    monitor.recordQualityLimitation(8_000, 'cpu')
    expect(monitor.recordQualityLimitation(9_000, 'bandwidth')).toBe(false)
    expect(monitor.recordQualityLimitation(12_000, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(19_000, 'none')).toBe(false)
    expect(monitor.recordQualityLimitation(20_000, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(29_999, 'cpu')).toBe(false)
    expect(monitor.recordQualityLimitation(30_000, 'cpu')).toBe(true)
  })

  it('treats a missing reason as not limited', () => {
    const monitor = new CpuMonitor()
    monitor.recordQualityLimitation(0, 'cpu')
    monitor.recordQualityLimitation(5_000, undefined)
    expect(monitor.recordQualityLimitation(11_000, 'cpu')).toBe(false)
  })
})
