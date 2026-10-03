/**
 * Recording compositor: draws the call onto a canvas captured with `captureStream(0)` and pushes one frame per clock
 * tick with `requestFrame()` (on the canvas track in Chrome and Safari, on the stream in Firefox).
 *
 * - The clock is the worker clock (clock.ts), so frames keep coming while the recorder's tab is in the background.
 * - Each tick reads the scene (who is in the call, which tracks `sources.ts` allows), keeps one muted `<video
 *   playsinline>` per drawable track in a hidden 1 px container inside the DOM, recomputes the layout when the tile list
 *   changes and draws every tile.
 * - `onLayout` reports layout changes (the controller turns them into subscription demands).
 */
import { CANVAS_BACKGROUND, drawTile, type DrawableTile } from './draw'
import type { FrameClock } from './clock'
import { computeRecordingLayout, type CanvasSize, type RecordingLayout, type TileKind } from './layout'

export interface SceneTile extends DrawableTile {
  /** `identity:camera` or `identity:screen_share`. */
  key: string
  kind: TileKind
  /** A track `sources.ts` allows to be drawn, or null (initials / empty). */
  track: MediaStreamTrack | null
}

export interface CompositorOptions {
  size: CanvasSize
  clock: FrameClock
  /** The tiles to draw, in order (read on every tick). */
  scene: () => SceneTile[]
  onLayout?: (layout: RecordingLayout, tiles: SceneTile[]) => void
  /** Runs after each drawn frame (duration limit checks). */
  onTick?: () => void
  document?: Document
}

interface CanvasCaptureTrack extends MediaStreamTrack {
  requestFrame?: () => void
}

const CONTAINER_STYLE =
  'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1'

export class Compositor {
  readonly canvas: HTMLCanvasElement
  readonly stream: MediaStream
  readonly track: MediaStreamTrack
  private readonly context: CanvasRenderingContext2D
  private readonly doc: Document
  private container: HTMLElement | null = null
  private readonly videos = new Map<string, { track: MediaStreamTrack; element: HTMLVideoElement }>()
  private layout: RecordingLayout = { mode: 'grid', tiles: [] }
  private layoutKey = ''
  private running = false
  private frames = 0

  constructor(private readonly options: CompositorOptions) {
    this.doc = options.document ?? document
    this.canvas = this.doc.createElement('canvas')
    this.canvas.width = options.size.width
    this.canvas.height = options.size.height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Canvas 2D is not available')
    this.context = context
    if (typeof this.canvas.captureStream !== 'function') throw new Error('Canvas capture is not available')
    // Frame rate 0: a frame is captured only when requestFrame() is called, once per clock tick.
    this.stream = this.canvas.captureStream(0)
    const track = this.stream.getVideoTracks()[0]
    if (!track) throw new Error('Canvas capture is not available')
    this.track = track
  }

  /** Frames drawn so far. */
  get frameCount(): number {
    return this.frames
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.tick()
    this.options.clock.start(() => this.tick())
  }

  stop(): void {
    this.running = false
    this.options.clock.stop()
    for (const key of [...this.videos.keys()]) this.removeVideo(key)
    this.container?.remove()
    this.container = null
    this.track.stop()
  }

  private tick() {
    if (!this.running) return
    let tiles: SceneTile[]
    try {
      tiles = this.options.scene()
    } catch {
      tiles = []
    }
    this.syncVideos(tiles)
    const key = tiles.map((tile) => tile.key).join('|')
    if (key !== this.layoutKey) {
      this.layoutKey = key
      this.layout = computeRecordingLayout(tiles, this.options.size)
      this.options.onLayout?.(this.layout, tiles)
    }
    this.draw(tiles)
    this.requestFrame()
    this.frames++
    this.options.onTick?.()
  }

  private draw(tiles: SceneTile[]) {
    const { width, height } = this.options.size
    const context = this.context
    context.fillStyle = CANVAS_BACKGROUND
    context.fillRect(0, 0, width, height)
    const byKey = new Map(tiles.map((tile) => [tile.key, tile]))
    for (const rect of this.layout.tiles) {
      const tile = byKey.get(rect.key)
      if (!tile) continue
      try {
        drawTile(context, tile, rect, this.videos.get(tile.key)?.element ?? null)
      } catch {
        // A frame that cannot be drawn (decoder hiccup) leaves the tile background for one tick.
      }
    }
  }

  private requestFrame() {
    const track = this.track as CanvasCaptureTrack
    if (typeof track.requestFrame === 'function') track.requestFrame()
    else {
      const stream = this.stream as MediaStream & { requestFrame?: () => void }
      stream.requestFrame?.()
    }
  }

  private ensureContainer(): HTMLElement {
    if (!this.container || !this.container.isConnected) {
      const element = this.doc.createElement('div')
      element.dataset.blinqRecording = ''
      element.setAttribute('aria-hidden', 'true')
      element.style.cssText = CONTAINER_STYLE
      this.doc.body.append(element)
      this.container = element
    }
    return this.container
  }

  private syncVideos(tiles: SceneTile[]) {
    const wanted = new Map<string, MediaStreamTrack>()
    for (const tile of tiles) if (tile.track) wanted.set(tile.key, tile.track)
    for (const [key, entry] of this.videos) {
      if (wanted.get(key) !== entry.track) this.removeVideo(key)
    }
    for (const [key, track] of wanted) {
      if (this.videos.has(key)) continue
      const element = this.doc.createElement('video')
      element.muted = true
      element.autoplay = true
      element.playsInline = true
      element.setAttribute('playsinline', '')
      element.disablePictureInPicture = true
      element.width = 1
      element.height = 1
      element.srcObject = new MediaStream([track])
      this.ensureContainer().append(element)
      void element.play().catch(() => undefined)
      this.videos.set(key, { track, element })
    }
  }

  private removeVideo(key: string) {
    const entry = this.videos.get(key)
    if (!entry) return
    this.videos.delete(key)
    entry.element.pause()
    entry.element.srcObject = null
    entry.element.remove()
  }
}
