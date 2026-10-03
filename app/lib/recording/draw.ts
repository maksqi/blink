/**
 * Canvas drawing for recording tiles: video (cover for cameras, contain for screen shares), initials when the camera
 * is off, the name label and a muted-mic icon. The pure parts (initials, colors, label text) are unit-tested.
 */
import { containFit, coverCrop, type TileRect } from './layout'

export const CANVAS_BACKGROUND = '#0b0b0e'
const TILE_BACKGROUND = '#1c1c22'
const LABEL_BACKGROUND = 'rgba(0, 0, 0, 0.6)'
const MUTED_RED = '#e5484d'
const FONT_STACK = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
const AVATAR_COLORS = ['#3b5bdb', '#0b7285', '#2b8a3e', '#a61e4d', '#862e9c', '#c2410c', '#5f3dc4', '#1864ab']

/** Up to two initials from a display name (first letters of the first and last word). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0]!)[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

/** A stable avatar color per identity. */
export function colorFor(identity: string): string {
  let hash = 0
  for (let index = 0; index < identity.length; index++) hash = (hash * 31 + identity.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

export function labelText(name: string, kind: 'camera' | 'screen'): string {
  const trimmed = name.trim() || 'Participant'
  return kind === 'screen' ? `${trimmed} (screen)` : trimmed
}

/** Name label size for a tile: readable on small filmstrip tiles, not huge on a full-canvas tile. */
export function labelFontSize(tileHeight: number): number {
  return Math.round(Math.min(26, Math.max(11, tileHeight * 0.055)))
}

export interface DrawableTile {
  identity: string
  name: string
  kind: 'camera' | 'screen'
  micMuted: boolean
}

type Context2D = CanvasRenderingContext2D

function roundedRect(context: Context2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, r)
    return
  }
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

/** A red badge with a slashed microphone, `size` px square at (x, y). */
function drawMicOff(context: Context2D, x: number, y: number, size: number) {
  const cx = x + size / 2
  const cy = y + size / 2
  context.fillStyle = MUTED_RED
  context.beginPath()
  context.arc(cx, cy, size / 2, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = '#ffffff'
  context.fillStyle = '#ffffff'
  context.lineCap = 'round'
  context.lineWidth = Math.max(1.5, size * 0.08)
  // Capsule.
  const capsuleWidth = size * 0.2
  const capsuleHeight = size * 0.34
  roundedRect(context, cx - capsuleWidth / 2, y + size * 0.18, capsuleWidth, capsuleHeight, capsuleWidth / 2)
  context.fill()
  // Cup and stem.
  context.beginPath()
  context.arc(cx, y + size * 0.42, size * 0.2, 0.15 * Math.PI, 0.85 * Math.PI)
  context.stroke()
  context.beginPath()
  context.moveTo(cx, y + size * 0.62)
  context.lineTo(cx, y + size * 0.78)
  context.stroke()
  // Slash.
  context.beginPath()
  context.moveTo(x + size * 0.24, y + size * 0.22)
  context.lineTo(x + size * 0.76, y + size * 0.8)
  context.stroke()
}

function drawInitials(context: Context2D, tile: DrawableTile, rect: TileRect) {
  const radius = Math.max(8, Math.min(rect.width, rect.height) * 0.2)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  context.fillStyle = colorFor(tile.identity)
  context.beginPath()
  context.arc(cx, cy, radius, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = `600 ${Math.round(radius * 0.8)}px ${FONT_STACK}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(initialsOf(tile.name), cx, cy + 1)
}

function drawLabel(context: Context2D, tile: DrawableTile, rect: TileRect) {
  const fontSize = labelFontSize(rect.height)
  const padding = Math.round(fontSize * 0.45)
  const iconSize = tile.kind === 'camera' && tile.micMuted ? Math.round(fontSize * 1.25) : 0
  context.font = `500 ${fontSize}px ${FONT_STACK}`
  const maxTextWidth = Math.max(0, rect.width - 4 * padding - iconSize)
  let text = labelText(tile.name, tile.kind)
  while (text.length > 1 && context.measureText(text).width > maxTextWidth) text = `${text.slice(0, -2)}…`
  const textWidth = Math.min(context.measureText(text).width, maxTextWidth)
  const height = Math.round(fontSize + padding * 1.4)
  const width = textWidth + padding * 2 + (iconSize ? iconSize + padding * 0.6 : 0)
  const x = rect.x + padding
  const y = rect.y + rect.height - height - padding
  context.fillStyle = LABEL_BACKGROUND
  roundedRect(context, x, y, width, height, height / 2)
  context.fill()
  let textX = x + padding
  if (iconSize) {
    drawMicOff(context, x + padding * 0.6, y + (height - iconSize) / 2, iconSize)
    textX += iconSize + padding * 0.4
  }
  context.fillStyle = '#ffffff'
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.fillText(text, textX, y + height / 2 + 1, maxTextWidth)
}

/** Whether a video element has a frame to draw. */
export function hasFrame(video: HTMLVideoElement | null | undefined): video is HTMLVideoElement {
  return Boolean(video) && video!.readyState >= 2 && video!.videoWidth > 0 && video!.videoHeight > 0
}

/** Draws one tile: background, video or initials, then the label. */
export function drawTile(context: Context2D, tile: DrawableTile, rect: TileRect, video: HTMLVideoElement | null) {
  const radius = Math.max(4, Math.min(rect.width, rect.height) * 0.03)
  context.save()
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, radius)
  context.clip()
  context.fillStyle = TILE_BACKGROUND
  context.fillRect(rect.x, rect.y, rect.width, rect.height)
  if (hasFrame(video)) {
    if (tile.kind === 'screen' || rect.stage) {
      const box = containFit(video.videoWidth, video.videoHeight, rect)
      context.drawImage(video, box.x, box.y, box.width, box.height)
    } else {
      const crop = coverCrop(video.videoWidth, video.videoHeight, rect.width, rect.height)
      context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, rect.x, rect.y, rect.width, rect.height)
    }
  } else if (tile.kind === 'camera') {
    drawInitials(context, tile, rect)
  }
  context.restore()
  drawLabel(context, tile, rect)
}
