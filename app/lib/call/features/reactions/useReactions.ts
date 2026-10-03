/**
 * Reactions of one call (keyed by the `CallContext`): the on-screen feed, the latest reaction per sender (tile badge)
 * and sending, end-to-end encrypted through `ctx.messaging`, at most 3 per second.
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { CallContext } from '../../../contracts/call'
import { ReactionFeed, type FeedItem, type Reaction } from './feed'
import { SEND_LIMIT, SlidingWindowLimiter } from './limiter'

export interface ReactionsState {
  readonly items: ShallowRef<readonly FeedItem[]>
  latestOf(identity: string): FeedItem | null
  /** Sends a reaction; false when over the send limit or not connected. */
  send(reaction: Reaction): Promise<boolean>
  canSend(): boolean
  dispose(): void
}

const states = new WeakMap<CallContext, ReactionsState>()

function createReactionsState(ctx: CallContext): ReactionsState {
  const feed = new ReactionFeed()
  const limiter = new SlidingWindowLimiter(SEND_LIMIT)
  const items = shallowRef<readonly FeedItem[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null

  function sync() {
    // Always a new array: tile badges re-read `latestOf()` whenever anything expired.
    items.value = [...feed.items]
    if (timer) clearTimeout(timer)
    timer = null
    const wait = feed.nextExpiry()
    if (wait !== null) {
      timer = setTimeout(() => {
        timer = null
        feed.prune()
        sync()
      }, wait + 20)
    }
  }

  const off = ctx.messaging.on('reaction', (body, from) => {
    if (feed.add(body, { identity: from.identity, name: from.name })) sync()
  })

  return {
    items,
    latestOf(identity) {
      void items.value
      return feed.latestOf(identity)
    },
    canSend() {
      return limiter.remaining('self', Date.now()) > 0
    },
    async send(reaction) {
      const self = ctx.self.value
      if (!self || ctx.phase.value !== 'inCall') return false
      if (!limiter.allow('self', Date.now())) return false
      try {
        await ctx.messaging.send('reaction', { reaction })
      } catch {
        return false
      }
      feed.add({ reaction }, { identity: self.identity, name: self.name }, true)
      sync()
      return true
    },
    dispose() {
      off()
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

export function reactionsState(ctx: CallContext): ReactionsState {
  let state = states.get(ctx)
  if (!state) {
    state = createReactionsState(ctx)
    states.set(ctx, state)
  }
  return state
}
