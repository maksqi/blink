/**
 * Recording canvas layout (pure). The canvas is 16:9 at the admin's `recording.maxResolution`.
 *
 * - Grid: everyone's camera tile (video or initials), up to 25, laid out with the call grid math (`computeGrid`, the
 *   desktop rules) and centered, the last row too.
 * - Presenter: while someone shares, the first share fills a stage of about 80 % of the width and every other tile
 *   (cameras, further shares) goes into a filmstrip on the right, again laid out with `computeGrid`.
 */
import { computeGrid, DESKTOP_PAGE_SIZE } from '../layout/grid'

export type RecordingResolution = '720p' | '1080p'

export interface CanvasSize {
  width: number
  height: number
}

export const CANVAS_SIZES: Record<RecordingResolution, CanvasSize> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
}

/** Video bitrate per canvas size (decision): 2.5 Mbit/s at 1080p, 1.5 Mbit/s at 720p. */
export const VIDEO_BITRATES: Record<RecordingResolution, number> = { '720p': 1_500_000, '1080p': 2_500_000 }
export const AUDIO_BITRATE = 128_000

export function canvasSizeFor(resolution: RecordingResolution): CanvasSize {
  return { ...(CANVAS_SIZES[resolution] ?? CANVAS_SIZES['720p']) }
}

/** Share of the canvas width the presenter stage takes (the filmstrip gets the rest). */
export const STAGE_SHARE = 0.8
/** At most this many tiles are drawn: the call limit (one page of the desktop grid). */
export const MAX_RECORDED_TILES = DESKTOP_PAGE_SIZE

export type TileKind = 'camera' | 'screen'

export interface LayoutItem {
  key: string
  kind: TileKind
}

export interface TileRect {
  key: string
  kind: TileKind
  x: number
  y: number
  width: number
  height: number
  /** The presenter stage (drawn with `contain`, never cropped). */
  stage: boolean
}

export interface RecordingLayout {
  mode: 'grid' | 'presenter'
  tiles: TileRect[]
}

export interface LayoutOptions {
  /** Space between tiles and around the edge, in canvas pixels (scaled with the canvas by default). */
  gap?: number
}

interface Area {
  x: number
  y: number
  width: number
  height: number
}

function defaultGap(canvas: CanvasSize): number {
  return Math.max(4, Math.round(canvas.height / 135))
}

/** Lays `items` out as a centered grid inside `area` (rows filled left to right, the last row centered). */
function gridIn(items: readonly LayoutItem[], area: Area, gap: number): TileRect[] {
  if (items.length === 0 || area.width <= 0 || area.height <= 0) return []
  const grid = computeGrid({ count: items.length, width: area.width, height: area.height, phone: false, gap })
  const { cols, rows, tileWidth, tileHeight } = grid
  const usedHeight = rows * tileHeight + (rows - 1) * gap
  const top = area.y + Math.max(0, (area.height - usedHeight) / 2)
  const tiles: TileRect[] = []
  items.forEach((item, index) => {
    const row = Math.floor(index / cols)
    const column = index % cols
    const inRow = Math.min(cols, items.length - row * cols)
    const rowWidth = inRow * tileWidth + (inRow - 1) * gap
    const left = area.x + Math.max(0, (area.width - rowWidth) / 2)
    tiles.push({
      key: item.key,
      kind: item.kind,
      x: Math.round(left + column * (tileWidth + gap)),
      y: Math.round(top + row * (tileHeight + gap)),
      width: tileWidth,
      height: tileHeight,
      stage: false,
    })
  })
  return tiles
}

/**
 * Tile rectangles for the canvas. `items` are in drawing order (the caller passes the participants' order: the
 * recorder first, then by join time); the first `screen` item becomes the stage.
 */
export function computeRecordingLayout(
  items: readonly LayoutItem[],
  canvas: CanvasSize,
  options: LayoutOptions = {},
): RecordingLayout {
  const gap = options.gap ?? defaultGap(canvas)
  const inner: Area = {
    x: gap,
    y: gap,
    width: Math.max(0, canvas.width - 2 * gap),
    height: Math.max(0, canvas.height - 2 * gap),
  }
  const stageIndex = items.findIndex((item) => item.kind === 'screen')
  if (stageIndex === -1) return { mode: 'grid', tiles: gridIn(items.slice(0, MAX_RECORDED_TILES), inner, gap) }

  const stageItem = items[stageIndex]!
  const strip = items.filter((_, index) => index !== stageIndex).slice(0, MAX_RECORDED_TILES)
  if (strip.length === 0) {
    return { mode: 'presenter', tiles: [{ ...stageItem, ...inner, stage: true }] }
  }
  const stageWidth = Math.round((inner.width - gap) * STAGE_SHARE)
  const stage: TileRect = { ...stageItem, x: inner.x, y: inner.y, width: stageWidth, height: inner.height, stage: true }
  const stripArea: Area = {
    x: inner.x + stageWidth + gap,
    y: inner.y,
    width: inner.width - stageWidth - gap,
    height: inner.height,
  }
  return { mode: 'presenter', tiles: [stage, ...gridIn(strip, stripArea, gap)] }
}

/** Source rectangle of a `sw`×`sh` frame drawn with `cover` into `dw`×`dh` (centered crop). */
export function coverCrop(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { sx: 0, sy: 0, sw: Math.max(0, sw), sh: Math.max(0, sh) }
  const scale = Math.max(dw / sw, dh / sh)
  const cw = dw / scale
  const ch = dh / scale
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch }
}

/** Destination rectangle of a `sw`×`sh` frame drawn with `contain` into the box (centered, letterboxed). */
export function containFit(
  sw: number,
  sh: number,
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (sw <= 0 || sh <= 0) return { ...box }
  const scale = Math.min(box.width / sw, box.height / sh)
  const width = sw * scale
  const height = sh * scale
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}
