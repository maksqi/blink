import { describe, expect, it } from 'vitest'
import {
  computeGrid,
  DEFAULT_GAP,
  DESKTOP_PAGE_SIZE,
  MAX_COLUMNS,
  MAX_ROWS,
  pageSlice,
  PHONE_PAGE_SIZE,
  viewportClass,
} from './grid'
import { computeSpeakerLayout, fitBox } from './speaker'

// Stage areas left for tiles after the top bar and the control bar (CSS pixels).
const SIZES = {
  desktop: { width: 1440 - 32, height: 900 - 56 - 88, phone: false },
  tablet: { width: 768 - 24, height: 1024 - 56 - 88, phone: false },
  phone: { width: 375 - 16, height: 667 - 48 - 80, phone: true },
  phoneLandscape: { width: 667 - 16, height: 375 - 40 - 64, phone: true },
} as const

describe('viewportClass', () => {
  it('classifies the three breakpoints the call UI is tested at', () => {
    expect(viewportClass(375, 667)).toBe('phone')
    expect(viewportClass(412, 915)).toBe('phone')
    expect(viewportClass(844, 390)).toBe('phone')
    expect(viewportClass(768, 1024)).toBe('tablet')
    expect(viewportClass(1024, 768)).toBe('desktop')
    expect(viewportClass(1440, 900)).toBe('desktop')
  })
})

describe('computeGrid', () => {
  for (const [name, size] of Object.entries(SIZES)) {
    describe(name, () => {
      for (let count = 1; count <= 25; count++) {
        it(`lays out ${count} tile(s)`, () => {
          const grid = computeGrid({ count, ...size })
          const pageSize = size.phone ? PHONE_PAGE_SIZE : DESKTOP_PAGE_SIZE
          const onPage = Math.min(count, pageSize)

          expect(grid.pageSize).toBe(pageSize)
          expect(grid.pages).toBe(Math.ceil(count / pageSize))
          expect(grid.cols * grid.rows).toBeGreaterThanOrEqual(onPage)
          // No empty row or column.
          expect((grid.cols - 1) * grid.rows).toBeLessThan(onPage)
          expect(grid.cols * (grid.rows - 1)).toBeLessThan(onPage)
          expect(grid.cols).toBeLessThanOrEqual(MAX_COLUMNS)
          expect(grid.rows).toBeLessThanOrEqual(MAX_ROWS)

          // Tiles fit the area and are 16:9 (within rounding).
          expect(grid.cols * grid.tileWidth + (grid.cols - 1) * DEFAULT_GAP).toBeLessThanOrEqual(size.width)
          expect(grid.rows * grid.tileHeight + (grid.rows - 1) * DEFAULT_GAP).toBeLessThanOrEqual(size.height)
          expect(grid.tileWidth).toBeGreaterThan(0)
          expect(Math.abs(grid.tileWidth / grid.tileHeight - 16 / 9)).toBeLessThan(0.05)

          if (size.phone) {
            const portrait = size.height >= size.width
            expect(grid.cols).toBeLessThanOrEqual(portrait ? 2 : 3)
            expect(grid.rows).toBeLessThanOrEqual(portrait ? 3 : 2)
          }
        })
      }
    })
  }

  it('uses a 5×5 grid for 25 tiles on desktop', () => {
    const grid = computeGrid({ count: 25, ...SIZES.desktop })
    expect([grid.cols, grid.rows]).toEqual([5, 5])
    expect(grid.pages).toBe(1)
  })

  it('pages phones at six tiles', () => {
    expect(computeGrid({ count: 6, ...SIZES.phone })).toMatchObject({ cols: 2, rows: 3, pages: 1 })
    expect(computeGrid({ count: 7, ...SIZES.phone })).toMatchObject({ cols: 2, rows: 3, pages: 2 })
    expect(computeGrid({ count: 25, ...SIZES.phone })).toMatchObject({ pages: 5 })
    expect(computeGrid({ count: 6, ...SIZES.phoneLandscape })).toMatchObject({ cols: 3, rows: 2 })
  })

  it('gives one person the whole stage and two people side by side on wide screens', () => {
    const one = computeGrid({ count: 1, ...SIZES.desktop })
    expect([one.cols, one.rows]).toEqual([1, 1])
    expect(one.tileWidth).toBeGreaterThan(1000)
    expect(computeGrid({ count: 2, ...SIZES.desktop })).toMatchObject({ cols: 2, rows: 1 })
    expect(computeGrid({ count: 2, ...SIZES.phone })).toMatchObject({ cols: 1, rows: 2 })
  })

  it('handles degenerate input without throwing', () => {
    expect(computeGrid({ count: 0, width: 800, height: 600, phone: false })).toMatchObject({
      cols: 1,
      rows: 1,
      pages: 1,
    })
    expect(computeGrid({ count: 4, width: 0, height: 0, phone: false }).tileWidth).toBe(0)
    expect(computeGrid({ count: 40, width: 1200, height: 700, phone: false })).toMatchObject({
      cols: 5,
      rows: 5,
      pages: 2,
    })
  })
})

describe('pageSlice', () => {
  const items = Array.from({ length: 14 }, (_, i) => i)
  it('returns the tiles of one page and clamps the page', () => {
    expect(pageSlice(items, 0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(pageSlice(items, 2, 6)).toEqual([12, 13])
    expect(pageSlice(items, 9, 6)).toEqual([12, 13])
    expect(pageSlice(items, -1, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(pageSlice([], 0, 6)).toEqual([])
  })
})

describe('computeSpeakerLayout', () => {
  it('puts the strip on the right on wide screens and at the bottom on tall ones', () => {
    const wide = computeSpeakerLayout({ width: 1400, height: 760, stripCount: 4, phone: false })
    expect(wide.strip.orientation).toBe('vertical')
    expect(wide.stage.width + wide.strip.tileWidth + DEFAULT_GAP).toBeLessThanOrEqual(1400)
    expect(wide.strip.visible).toBeGreaterThanOrEqual(3)

    const tall = computeSpeakerLayout({ width: 360, height: 540, stripCount: 4, phone: true })
    expect(tall.strip.orientation).toBe('horizontal')
    expect(tall.stage.height + tall.strip.tileHeight + DEFAULT_GAP).toBeLessThanOrEqual(540)
    expect(tall.strip.tileWidth).toBeLessThanOrEqual(320)
  })

  it('gives the stage everything when nobody else is in the strip', () => {
    expect(computeSpeakerLayout({ width: 1000, height: 600, stripCount: 0, phone: false }).stage).toEqual({
      width: 1000,
      height: 600,
    })
  })

  it('keeps filmstrip tiles small (they request a low simulcast layer)', () => {
    for (const [width, height] of [
      [1440, 760],
      [1920, 1000],
      [768, 880],
      [375, 540],
    ] as const) {
      const layout = computeSpeakerLayout({ width, height, stripCount: 10, phone: width < 640 })
      expect(layout.strip.tileWidth).toBeLessThanOrEqual(284)
    }
  })
})

describe('fitBox', () => {
  it('fits a 16:9 box', () => {
    expect(fitBox(1600, 600)).toEqual({ width: 1066, height: 600 })
    expect(fitBox(320, 600)).toEqual({ width: 320, height: 180 })
  })
})
