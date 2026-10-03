/**
 * Subscription policy (pure): which remote publications to subscribe, which to pause and at what size.
 * docs/ARCHITECTURE.md §7, docs/SECURITY.md §3.2.
 *
 * Rules, in order:
 * 1. A participant with a publication whose encryption is NONE, now or earlier in this call (`untrusted`), has every
 *    publication blocked: none is subscribed (so nothing of theirs is attached, mixed or recorded) and the participant
 *    is reported as blocked. Nothing overrides this, not even a feature demand. Blocking the whole participant matters
 *    because livekit-client keeps one decrypt flag per participant that any of their publications can turn off.
 * 2. A client that is not encrypted itself (the test-only `e2ee=off` harness client) subscribes to nothing.
 * 3. Audio (microphone, screen-share audio) is always subscribed and enabled, also in background tabs.
 * 4. Video is subscribed and paused unless a visible tile on the current page (in a visible document) or a feature
 *    demand (recording) needs it; then it is enabled at the largest requested size. Paused tracks resume instantly.
 * 5. Pinned tiles and the screen-share stage keep their size; the other tiles share a pixel budget and are scaled
 *    down together when they would exceed it. Demands are never scaled down.
 */
import type { VideoDemand } from '../contracts/call'

export type PublicationSource = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio' | 'unknown'
export type VideoSource = VideoDemand['source']

export interface PolicyPublication {
  trackSid: string
  identity: string
  kind: 'audio' | 'video'
  source: PublicationSource
  /** `encryptionType !== NONE` as reported by LiveKit for this publication. */
  encrypted: boolean
}

export interface TileRequest {
  identity: string
  source: VideoSource
  /** Rendered size in device pixels (CSS size × devicePixelRatio). */
  width: number
  height: number
  /** In the viewport (IntersectionObserver). Tiles on other pages are not reported at all. */
  visible: boolean
  /** Pinned tile or the screen-share stage: exempt from the pixel budget. */
  priority?: boolean
}

export interface PolicyInput {
  publications: readonly PolicyPublication[]
  tiles: readonly TileRequest[]
  /** `document.visibilityState === 'visible'`. */
  documentVisible: boolean
  demands: readonly VideoDemand[]
  /** Whether this client itself encrypts (E2EE enabled). */
  localEncrypted: boolean
  /** Max sum of requested device pixels for tiles without priority. */
  pixelBudget?: number
  /** Identities already blocked earlier in this call (the block is sticky; see rule 1). */
  untrusted?: Iterable<string>
}

export interface SubscriptionDecision {
  trackSid: string
  identity: string
  kind: 'audio' | 'video'
  source: PublicationSource
  subscribed: boolean
  enabled: boolean
  /** Requested video size in pixels (video tracks that are enabled). */
  width?: number
  height?: number
  /** The participant is blocked (rule 1): never subscribed. */
  blocked: boolean
}

export interface SubscriptionPlan {
  decisions: SubscriptionDecision[]
  /** Blocked identities, sorted: `untrusted` plus every identity with an unencrypted publication. */
  blockedIdentities: string[]
}

/** About three 1080p streams of device pixels (decision). */
export const DEFAULT_PIXEL_BUDGET = 1920 * 1080 * 3
/** Tiles are never requested narrower than this when the budget scales them down. */
export const MIN_BUDGET_WIDTH = 160

interface Size {
  width: number
  height: number
}

function videoSourceOf(source: PublicationSource): VideoSource {
  return source === 'screen_share' ? 'screen_share' : 'camera'
}

function larger(a: Size | undefined, b: Size): Size {
  if (!a) return b
  return { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) }
}

function validSize(size: Size): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}

export function computeSubscriptions(input: PolicyInput): SubscriptionPlan {
  const budget = input.pixelBudget ?? DEFAULT_PIXEL_BUDGET
  const key = (identity: string, source: VideoSource) => `${identity}\u0000${source}`

  // Largest visible tile per (identity, source), split by priority.
  const tileSizes = new Map<string, { size: Size; priority: boolean }>()
  if (input.documentVisible) {
    for (const tile of input.tiles) {
      if (!tile.visible || !validSize(tile)) continue
      const k = key(tile.identity, tile.source)
      const current = tileSizes.get(k)
      tileSizes.set(k, {
        size: larger(current?.size, tile),
        priority: Boolean(current?.priority || tile.priority),
      })
    }
  }

  // Scale non-priority tiles into the pixel budget.
  let normalPixels = 0
  for (const { size, priority } of tileSizes.values()) if (!priority) normalPixels += size.width * size.height
  const scale = normalPixels > budget ? Math.sqrt(budget / normalPixels) : 1

  const demandSizes = new Map<string, Size>()
  for (const demand of input.demands) {
    if (!validSize(demand)) continue
    const k = key(demand.identity, demand.source)
    demandSizes.set(k, larger(demandSizes.get(k), demand))
  }

  const blocked = new Set<string>(input.untrusted ?? [])
  for (const publication of input.publications) if (!publication.encrypted) blocked.add(publication.identity)
  const decisions: SubscriptionDecision[] = []
  const sorted = [...input.publications].sort((a, b) =>
    a.identity === b.identity ? a.trackSid.localeCompare(b.trackSid) : a.identity.localeCompare(b.identity),
  )

  for (const publication of sorted) {
    const base = {
      trackSid: publication.trackSid,
      identity: publication.identity,
      kind: publication.kind,
      source: publication.source,
    }
    if (blocked.has(publication.identity)) {
      decisions.push({ ...base, subscribed: false, enabled: false, blocked: true })
      continue
    }
    if (!input.localEncrypted) {
      decisions.push({ ...base, subscribed: false, enabled: false, blocked: false })
      continue
    }
    if (publication.kind === 'audio') {
      decisions.push({ ...base, subscribed: true, enabled: true, blocked: false })
      continue
    }

    const k = key(publication.identity, videoSourceOf(publication.source))
    const tile = tileSizes.get(k)
    let size: Size | undefined
    if (tile) {
      const factor = tile.priority ? 1 : scale
      const width = Math.max(tile.size.width * factor, Math.min(tile.size.width, MIN_BUDGET_WIDTH))
      size = { width, height: (tile.size.height * width) / tile.size.width }
    }
    const demand = demandSizes.get(k)
    if (demand) size = larger(size, demand)

    decisions.push(
      size
        ? {
            ...base,
            subscribed: true,
            enabled: true,
            width: Math.ceil(size.width),
            height: Math.ceil(size.height),
            blocked: false,
          }
        : { ...base, subscribed: true, enabled: false, blocked: false },
    )
  }

  return { decisions, blockedIdentities: [...blocked].sort() }
}
