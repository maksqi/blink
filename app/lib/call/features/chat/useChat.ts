/**
 * Chat state of one call (keyed by the `CallContext`): the log, the unread count while the panel is closed, and send
 * with inline failures. Messages travel end-to-end encrypted through `ctx.messaging` (the app envelope); this module
 * never sees ciphertext or keys.
 */
import { onBeforeUnmount, onMounted, shallowRef, type ShallowRef } from 'vue'
import type { CallContext } from '../../../contracts/call'
import { ChatLog, validateDraft, type ChatMessage } from './chat-store'
import { useCall } from '~/composables/call'

export interface ChatState {
  readonly messages: ShallowRef<readonly ChatMessage[]>
  readonly unread: ShallowRef<number>
  /** False while the host turned chat off. */
  enabled(): boolean
  setPanelOpen(open: boolean): void
  /** Sends a draft; resolves with an error text, or null when sent (or shown as failed with Retry). */
  send(draft: string): Promise<string | null>
  retry(message: ChatMessage): Promise<void>
  dismiss(message: ChatMessage): void
  dispose(): void
}

export const CHAT_DISABLED_TEXT = 'The host turned off chat'

const states = new WeakMap<CallContext, ChatState>()

function createChatState(ctx: CallContext): ChatState {
  const log = new ChatLog()
  const messages = shallowRef<readonly ChatMessage[]>([])
  const unread = shallowRef(0)
  let panelOpen = false

  const sync = () => {
    messages.value = log.messages
    unread.value = log.unread
  }
  const enabled = () => ctx.roomState.value?.chatEnabled !== false

  const off = ctx.messaging.on('chat', (body, from, ts) => {
    const result = log.receive(body, { identity: from.identity, name: from.name }, ts, {
      chatEnabled: enabled(),
      panelOpen,
    })
    if (result.accepted) sync()
  })

  async function deliver(text: string): Promise<void> {
    const self = ctx.self.value
    const sender = { identity: self?.identity ?? '', name: self?.name ?? 'You' }
    try {
      await ctx.messaging.send('chat', { text })
      log.addOwn(text, sender)
    } catch {
      log.addOwn(text, sender, 'failed')
    }
    sync()
  }

  return {
    messages,
    unread,
    enabled,
    setPanelOpen(open) {
      panelOpen = open
      if (open) {
        log.markRead()
        sync()
      }
    },
    async send(draft) {
      if (!enabled()) return CHAT_DISABLED_TEXT
      if (ctx.phase.value !== 'inCall') return 'You are not connected to the meeting.'
      const checked = validateDraft(draft)
      if (!checked.ok) return checked.error
      await deliver(checked.text)
      return null
    },
    async retry(message) {
      if (!message.own || message.status !== 'failed' || !enabled()) return
      log.remove(message.id)
      sync()
      await deliver(message.text)
    },
    dismiss(message) {
      log.remove(message.id)
      sync()
    },
    dispose() {
      off()
    },
  }
}

export function chatState(ctx: CallContext): ChatState {
  let state = states.get(ctx)
  if (!state) {
    state = createChatState(ctx)
    states.set(ctx, state)
  }
  return state
}

/** In the chat panel: marks messages read while the panel is open. */
export function useChat(): ChatState {
  const state = chatState(useCall())
  onMounted(() => state.setPanelOpen(true))
  onBeforeUnmount(() => state.setPanelOpen(false))
  return state
}
