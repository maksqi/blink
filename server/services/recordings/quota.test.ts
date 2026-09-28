import { describe, expect, it } from 'vitest'
import { exceedsQuota, quotaLimitBytes, quotaUsedUp } from './quota'

const GIB = 1024 ** 3

describe('recording quota', () => {
  it('treats 0 GB as unlimited', () => {
    expect(quotaLimitBytes(0)).toBeNull()
    expect(exceedsQuota(10 ** 15, 10 ** 15, 0)).toBe(false)
    expect(quotaUsedUp(10 ** 15, 0)).toBe(false)
  })

  it('converts fractional gigabytes to bytes', () => {
    expect(quotaLimitBytes(20)).toBe(20 * GIB)
    expect(quotaLimitBytes(0.5)).toBe(GIB / 2)
    expect(quotaLimitBytes(0.000001)).toBe(1073)
  })

  it('allows usage up to the limit and rejects anything beyond it', () => {
    expect(exceedsQuota(GIB - 10, 10, 1)).toBe(false)
    expect(exceedsQuota(GIB - 10, 11, 1)).toBe(true)
    expect(exceedsQuota(0, GIB + 1, 1)).toBe(true)
  })

  it('reports a quota as used up once usage reaches the limit', () => {
    expect(quotaUsedUp(GIB - 1, 1)).toBe(false)
    expect(quotaUsedUp(GIB, 1)).toBe(true)
    expect(quotaUsedUp(GIB + 5, 1)).toBe(true)
  })
})
