import { describe, expect, it } from 'vitest'
import {
  canvasSizeFor,
  computeRecordingLayout,
  containFit,
  coverCrop,
  MAX_RECORDED_TILES,
  STAGE_SHARE,
  VIDEO_BITRATES,
  type CanvasSize,
  type LayoutItem,
  type TileRect,
} from './layout'

const cameras = (count: number): LayoutItem[] =>
  Array.from({ length: count }, (_, index) => ({ key: `p_${index}:camera`, kind: 'camera' as const }))

function inside(tile: TileRect, canvas: CanvasSize) {
  expect(tile.x).toBeGreaterThanOrEqual(0)
  expect(tile.y).toBeGreaterThanOrEqual(0)
  expect(tile.x + tile.width).toBeLessThanOrEqual(canvas.width)
  expect(tile.y + tile.height).toBeLessThanOrEqual(canvas.height)
}

function overlaps(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function expectNoOverlap(tiles: TileRect[]) {
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) expect(overlaps(tiles[i]!, tiles[j]!)).toBe(false)
  }
}

describe('canvasSizeFor', () => {
  it('is 16:9 at the admin resolution', () => {
    expect(canvasSizeFor('720p')).toEqual({ width: 1280, height: 720 })
    expect(canvasSizeFor('1080p')).toEqual({ width: 1920, height: 1080 })
    expect(VIDEO_BITRATES['1080p']).toBe(2_500_000)
    expect(VIDEO_BITRATES['720p']).toBe(1_500_000)
  })
})

describe('computeRecordingLayout: grid', () => {
  for (const canvas of [canvasSizeFor('720p'), canvasSizeFor('1080p')]) {
    for (let count = 1; count <= 25; count++) {
      it(`places ${count} tile(s) on ${canvas.width}x${canvas.height} without overlap`, () => {
        const layout = computeRecordingLayout(cameras(count), canvas)
        expect(layout.mode).toBe('grid')
        expect(layout.tiles.map((tile) => tile.key)).toEqual(cameras(count).map((item) => item.key))
        const [first] = layout.tiles
        for (const tile of layout.tiles) {
          inside(tile, canvas)
          expect(tile.stage).toBe(false)
          // One grid: every tile has the same 16:9 size.
          expect(tile.width).toBe(first!.width)
          expect(tile.height).toBe(first!.height)
          expect(Math.abs(tile.width / tile.height - 16 / 9)).toBeLessThan(0.02)
        }
        expectNoOverlap(layout.tiles)
      })
    }
  }

  it('fills most of the canvas with a single tile', () => {
    const canvas = canvasSizeFor('1080p')
    const [tile] = computeRecordingLayout(cameras(1), canvas).tiles
    expect(tile!.width).toBeGreaterThan(canvas.width * 0.95)
  })

  it('centers a short last row', () => {
    const canvas = canvasSizeFor('1080p')
    const tiles = computeRecordingLayout(cameras(3), canvas).tiles
    // 2 columns: the third tile sits centered under the first two.
    const [a, b, c] = tiles
    expect(a!.y).toBe(b!.y)
    expect(c!.y).toBeGreaterThan(a!.y)
    const rowCenter = (a!.x + b!.x + b!.width) / 2
    expect(Math.abs(c!.x + c!.width / 2 - rowCenter)).toBeLessThanOrEqual(1)
  })

  it('centers the grid vertically', () => {
    const canvas = canvasSizeFor('1080p')
    const tiles = computeRecordingLayout(cameras(2), canvas).tiles
    const top = Math.min(...tiles.map((tile) => tile.y))
    const bottom = Math.max(...tiles.map((tile) => tile.y + tile.height))
    expect(Math.abs(top - (canvas.height - bottom))).toBeLessThanOrEqual(1)
  })

  it(`draws at most ${MAX_RECORDED_TILES} tiles`, () => {
    const layout = computeRecordingLayout(cameras(30), canvasSizeFor('1080p'))
    expect(layout.tiles).toHaveLength(MAX_RECORDED_TILES)
  })

  it('returns no tiles for nobody', () => {
    expect(computeRecordingLayout([], canvasSizeFor('720p')).tiles).toEqual([])
  })
})

describe('computeRecordingLayout: presenter', () => {
  const canvas = canvasSizeFor('1080p')

  for (const count of [1, 2, 5, 6, 12, 24]) {
    it(`puts the share on an ~80 % stage and ${count} camera(s) in the filmstrip`, () => {
      const items: LayoutItem[] = [...cameras(count), { key: 'p_1:screen_share', kind: 'screen' }]
      const layout = computeRecordingLayout(items, canvas)
      expect(layout.mode).toBe('presenter')
      const [stage, ...strip] = layout.tiles
      expect(stage).toMatchObject({ key: 'p_1:screen_share', kind: 'screen', stage: true })
      expect(stage!.width / canvas.width).toBeGreaterThan(STAGE_SHARE - 0.03)
      expect(stage!.width / canvas.width).toBeLessThan(STAGE_SHARE + 0.01)
      expect(strip.map((tile) => tile.key)).toEqual(cameras(count).map((item) => item.key))
      for (const tile of layout.tiles) inside(tile, canvas)
      for (const tile of strip) expect(tile.x).toBeGreaterThan(stage!.x + stage!.width)
      expectNoOverlap(layout.tiles)
    })
  }

  it('moves further shares into the filmstrip', () => {
    const items: LayoutItem[] = [
      { key: 'p_a:camera', kind: 'camera' },
      { key: 'p_a:screen_share', kind: 'screen' },
      { key: 'p_b:camera', kind: 'camera' },
      { key: 'p_b:screen_share', kind: 'screen' },
    ]
    const layout = computeRecordingLayout(items, canvas)
    expect(layout.tiles.filter((tile) => tile.stage).map((tile) => tile.key)).toEqual(['p_a:screen_share'])
    expect(layout.tiles.map((tile) => tile.key)).toEqual([
      'p_a:screen_share',
      'p_a:camera',
      'p_b:camera',
      'p_b:screen_share',
    ])
  })

  it('gives a lone share the whole canvas', () => {
    const layout = computeRecordingLayout([{ key: 'p_a:screen_share', kind: 'screen' }], canvas)
    expect(layout.tiles).toHaveLength(1)
    expect(layout.tiles[0]!.width).toBeGreaterThan(canvas.width * 0.95)
  })

  it(`caps the filmstrip at ${MAX_RECORDED_TILES} tiles`, () => {
    const layout = computeRecordingLayout([{ key: 'share', kind: 'screen' }, ...cameras(30)], canvas)
    expect(layout.tiles).toHaveLength(1 + MAX_RECORDED_TILES)
  })
})

describe('coverCrop and containFit', () => {
  it('crops the sides of a wide frame for a narrower tile', () => {
    expect(coverCrop(1920, 1080, 1080, 1080)).toEqual({ sx: 420, sy: 0, sw: 1080, sh: 1080 })
  })

  it('crops top and bottom of a tall frame for a 16:9 tile', () => {
    const crop = coverCrop(720, 1280, 1280, 720)
    expect(crop.sx).toBe(0)
    expect(crop.sw).toBe(720)
    expect(crop.sh).toBeCloseTo(405)
    expect(crop.sy).toBeCloseTo((1280 - 405) / 2)
  })

  it('letterboxes with contain', () => {
    expect(containFit(1000, 1000, { x: 10, y: 20, width: 400, height: 200 })).toEqual({
      x: 110,
      y: 20,
      width: 200,
      height: 200,
    })
  })

  it('handles frames without a size yet', () => {
    expect(coverCrop(0, 0, 100, 100)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 })
    expect(containFit(0, 0, { x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })
})
