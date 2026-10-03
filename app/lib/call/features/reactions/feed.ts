/**
 * Reactions: the catalog (emoji written as `\u{...}` escapes, decision) and the on-screen feed (pure). A reaction shows
 * for about 3 s with the sender's name; at most 20 are on screen; every sender's latest reaction also shows on their
 * tile for 3 s.
 */
import { REACTIONS, reactionBodySchema } from '#shared/schemas/livekit'
import { RECEIVE_LIMIT, SlidingWindowLimiter } from './limiter'

export type Reaction = (typeof REACTIONS)[number]

export const REACTION_EMOJI: Record<Reaction, string> = {
  thumbs_up: '\u{1F44D}',
  clap: '\u{1F44F}',
  heart: '\u{2764}\u{FE0F}',
  laugh: '\u{1F602}',
  surprised: '\u{1F62E}',
  party: '\u{1F389}',
}

export const REACTION_LABEL: Record<Reaction, string> = {
  thumbs_up: 'Thumbs up',
  clap: 'Clap',
  heart: 'Heart',
  laugh: 'Laugh',
  surprised: 'Surprised',
  party: 'Party',
}

export const REACTION_LIST: readonly Reaction[] = REACTIONS

export interface FeedItem {
  id: number
  reaction: Reaction
  identity: string
  name: string
  at: number
  /** Horizontal start position (0..1), spread so bursts do not stack on one line. */
  lane: number
}

export interface FeedOptions {
  durationMs?: number
  maxVisible?: number
  now?: () => number
}

export const FEED_DURATION_MS = 3_000
export const FEED_MAX_VISIBLE = 20

export class ReactionFeed {
  private list: FeedItem[] = []
  private readonly latest = new Map<string, FeedItem>()
  private counter = 0
  private readonly durationMs: number
  private readonly maxVisible: number
  private readonly now: () => number
  private readonly limiter = new SlidingWindowLimiter(RECEIVE_LIMIT)

  constructor(options: FeedOptions = {}) {
    this.durationMs = options.durationMs ?? FEED_DURATION_MS
    this.maxVisible = options.maxVisible ?? FEED_MAX_VISIBLE
    this.now = options.now ?? Date.now
  }

  get items(): readonly FeedItem[] {
    return this.list
  }

  /**
   * Adds a reaction. Remote bodies are validated with `reactionBodySchema` and limited per sender; own reactions
   * (`own: true`) were limited when sending. Returns the item, or null when dropped.
   */
  add(body: unknown, from: { identity: string; name: string }, own = false): FeedItem | null {
    const parsed = reactionBodySchema.safeParse(body)
    if (!parsed.success) return null
    const at = this.now()
    if (!own && !this.limiter.allow(from.identity, at)) return null
    this.prune()
    this.counter++
    const item: FeedItem = {
      id: this.counter,
      reaction: parsed.data.reaction,
      identity: from.identity,
      name: from.name,
      at,
      // Golden-ratio spread over the width: consecutive items never share a lane.
      lane: (this.counter * 0.618_034) % 1,
    }
    this.list = [...this.list, item].slice(-this.maxVisible)
    this.latest.set(from.identity, item)
    return item
  }

  /** Drops expired items; returns true when something changed. */
  prune(): boolean {
    const cutoff = this.now() - this.durationMs
    const kept = this.list.filter((item) => item.at > cutoff)
    for (const [identity, item] of this.latest) if (item.at <= cutoff) this.latest.delete(identity)
    if (kept.length === this.list.length) return false
    this.list = kept
    return true
  }

  /** The sender's latest reaction while it is still on screen. */
  latestOf(identity: string): FeedItem | null {
    const item = this.latest.get(identity)
    if (!item || item.at <= this.now() - this.durationMs) return null
    return item
  }

  /** Milliseconds until the next item expires (for the prune timer), or null when empty. */
  nextExpiry(): number | null {
    const first = this.list[0]
    const firstLatest = Math.min(...[...this.latest.values()].map((item) => item.at))
    const oldest = Math.min(first?.at ?? Number.POSITIVE_INFINITY, firstLatest)
    if (!Number.isFinite(oldest)) return null
    return Math.max(0, oldest + this.durationMs - this.now())
  }
}
