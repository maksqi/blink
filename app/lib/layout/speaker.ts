/**
 * Speaker (and presentation) layout: one large stage plus a filmstrip of the other tiles (pure).
 *
 * The strip sits on the right on wide screens and at the bottom on tall ones, including phones in portrait. It scrolls
 * when more tiles exist than fit; `visible` is how many fit without scrolling.
 */
import { DEFAULT_GAP, TILE_ASPECT } from './grid'

export interface SpeakerInput {
  width: number
  height: number
  /** Tiles in the filmstrip (everyone except the stage tile). */
  stripCount: number
  phone: boolean
  gap?: number
  aspect?: number
}

export interface SpeakerLayout {
  stage: { width: number; height: number }
  strip: {
    orientation: 'horizontal' | 'vertical'
    tileWidth: number
    tileHeight: number
    /** Tiles that fit without scrolling. */
    visible: number
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function computeSpeakerLayout({
  width,
  height,
  stripCount,
  phone,
  gap = DEFAULT_GAP,
  aspect = TILE_ASPECT,
}: SpeakerInput): SpeakerLayout {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  const vertical = w / Math.max(h, 1) > 1.25
  if (stripCount <= 0) {
    return {
      stage: { width: Math.floor(w), height: Math.floor(h) },
      strip: { orientation: vertical ? 'vertical' : 'horizontal', tileWidth: 0, tileHeight: 0, visible: 0 },
    }
  }

  if (vertical) {
    const tileWidth = Math.floor(clamp(w * 0.2, phone ? 112 : 160, 280))
    const tileHeight = Math.floor(tileWidth / aspect)
    return {
      stage: { width: Math.max(0, Math.floor(w - tileWidth - gap)), height: Math.floor(h) },
      strip: {
        orientation: 'vertical',
        tileWidth,
        tileHeight,
        visible: Math.max(1, Math.floor((h + gap) / (tileHeight + gap))),
      },
    }
  }

  const tileHeight = Math.floor(clamp(h * 0.18, phone ? 72 : 90, 160))
  const tileWidth = Math.floor(tileHeight * aspect)
  return {
    stage: { width: Math.floor(w), height: Math.max(0, Math.floor(h - tileHeight - gap)) },
    strip: {
      orientation: 'horizontal',
      tileWidth,
      tileHeight,
      visible: Math.max(1, Math.floor((w + gap) / (tileWidth + gap))),
    },
  }
}

/** Largest 16:9 (or `aspect`) box that fits into `width` × `height`. */
export function fitBox(width: number, height: number, aspect = TILE_ASPECT): { width: number; height: number } {
  const boxWidth = Math.max(0, Math.min(width, height * aspect))
  return { width: Math.floor(boxWidth), height: Math.floor(boxWidth / aspect) }
}
