/**
 * Tracks the rendered video tiles (size via ResizeObserver, visibility via IntersectionObserver) and feeds them to the
 * SubscriptionManager as `TileRequest`s in device pixels. Tiles register themselves (useVideoTile); off-page tiles are
 * not rendered, so they are simply absent.
 */
import type { TileRequest, VideoSource } from '../livekit/subscription-policy'

export interface TileInfo {
  identity: string
  source: VideoSource
  priority: boolean
  /** Local tiles never request anything. */
  isLocal: boolean
}

interface Entry {
  info: TileInfo
  width: number
  height: number
  visible: boolean
}

export class TileTracker {
  private readonly entries = new Map<Element, Entry>()
  private resizeObserver: ResizeObserver | null = null
  private intersectionObserver: IntersectionObserver | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly push: (tiles: TileRequest[]) => void,
    private readonly delayMs = 120,
  ) {}

  register(element: Element, info: TileInfo): { update(info: TileInfo): void; unregister(): void } {
    this.ensureObservers()
    const rect = element.getBoundingClientRect()
    this.entries.set(element, { info, width: rect.width, height: rect.height, visible: true })
    this.resizeObserver?.observe(element)
    this.intersectionObserver?.observe(element)
    this.schedule()
    return {
      update: (next) => {
        const entry = this.entries.get(element)
        if (!entry) return
        entry.info = next
        this.schedule()
      },
      unregister: () => {
        this.entries.delete(element)
        this.resizeObserver?.unobserve(element)
        this.intersectionObserver?.unobserve(element)
        this.schedule()
      },
    }
  }

  /** Pushes the current tiles now (after layout changes that observers may report late). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ratio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    const tiles: TileRequest[] = []
    for (const { info, width, height, visible } of this.entries.values()) {
      if (info.isLocal) continue
      tiles.push({
        identity: info.identity,
        source: info.source,
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
        visible,
        priority: info.priority,
      })
    }
    this.push(tiles)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.entries.clear()
  }

  private schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  private ensureObservers() {
    if (typeof window === 'undefined') return
    if (!this.resizeObserver && 'ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver((records) => {
        for (const record of records) {
          const entry = this.entries.get(record.target)
          if (!entry) continue
          const box = record.contentRect
          entry.width = box.width
          entry.height = box.height
        }
        this.schedule()
      })
    }
    if (!this.intersectionObserver && 'IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        (records) => {
          for (const record of records) {
            const entry = this.entries.get(record.target)
            if (entry) entry.visible = record.isIntersecting
          }
          this.schedule()
        },
        { threshold: 0.01 },
      )
    }
  }
}
