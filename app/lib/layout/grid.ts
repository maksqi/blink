/**
 * Grid layout math for the call view (pure, unit-tested for 1..25 tiles on phone, tablet and desktop sizes).
 *
 * Tiles are 16:9 and never exceed a 5×5 grid. Phones page at 6 tiles (2×3 portrait, 3×2 landscape) (decision), so a
 * phone never decodes more than six camera streams at once.
 */

export const MAX_COLUMNS = 5
export const MAX_ROWS = 5
export const DESKTOP_PAGE_SIZE = MAX_COLUMNS * MAX_ROWS
export const PHONE_PAGE_SIZE = 6
export const TILE_ASPECT = 16 / 9
export const DEFAULT_GAP = 8

export type ViewportClass = 'phone' | 'tablet' | 'desktop'

/** Phones are narrow portrait screens and short landscape screens (decision). */
export function viewportClass(width: number, height: number): ViewportClass {
  if (width < 640 || (height < 500 && width < 1024)) return 'phone'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

export interface GridInput {
  /** Number of tiles in the call (all pages). */
  count: number
  /** Size of the area the grid fills, in CSS pixels. */
  width: number
  height: number
  phone: boolean
  gap?: number
  aspect?: number
}

export interface GridLayout {
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  /** Tiles per page (25 on tablets and desktops, 6 on phones). */
  pageSize: number
  pages: number
}

/**
 * Picks the column count that gives the largest 16:9 tiles for one full page. Every page uses the same grid, so tiles
 * keep their size when paging.
 */
export function computeGrid({ count, width, height, phone, gap = DEFAULT_GAP, aspect = TILE_ASPECT }: GridInput): GridLayout {
  const pageSize = phone ? PHONE_PAGE_SIZE : DESKTOP_PAGE_SIZE
  const total = Math.max(0, Math.floor(count))
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const n = Math.min(Math.max(total, 1), pageSize)
  const portrait = height >= width
  const maxCols = phone ? (portrait ? 2 : 3) : MAX_COLUMNS
  const maxRows = phone ? (portrait ? 3 : 2) : MAX_ROWS
  const areaWidth = Math.max(0, width)
  const areaHeight = Math.max(0, height)

  let best: { cols: number; rows: number; tileWidth: number; empty: number } | null = null
  for (let cols = 1; cols <= Math.min(n, maxCols); cols++) {
    const rows = Math.ceil(n / cols)
    if (rows > maxRows) continue
    const cellWidth = (areaWidth - gap * (cols - 1)) / cols
    const cellHeight = (areaHeight - gap * (rows - 1)) / rows
    const tileWidth = Math.max(0, Math.min(cellWidth, cellHeight * aspect))
    const empty = cols * rows - n
    // Larger tiles win; on a tie (both limited by the same side) fewer empty cells look tidier.
    if (!best || tileWidth > best.tileWidth + 0.5 || (Math.abs(tileWidth - best.tileWidth) <= 0.5 && empty < best.empty)) {
      best = { cols, rows, tileWidth, empty }
    }
  }
  if (!best) {
    const cols = maxCols
    const rows = Math.ceil(n / cols)
    const cellWidth = (areaWidth - gap * (cols - 1)) / cols
    const cellHeight = (areaHeight - gap * (rows - 1)) / rows
    best = { cols, rows, tileWidth: Math.max(0, Math.min(cellWidth, cellHeight * aspect)), empty: cols * rows - n }
  }

  const tileWidth = Math.floor(best.tileWidth)
  return {
    cols: best.cols,
    rows: best.rows,
    tileWidth,
    tileHeight: Math.floor(tileWidth / aspect),
    pageSize,
    pages,
  }
}

/** The tiles shown on `page` (0-based, clamped). */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(0, Math.floor(page)), pages - 1)
  return items.slice(current * pageSize, current * pageSize + pageSize)
}
