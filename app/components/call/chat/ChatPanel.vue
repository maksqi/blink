<script setup lang="ts">
/**
 * "Chat" side panel: end-to-end encrypted, text-only messages. Enter sends, Shift+Enter adds a line, IME composition
 * is respected; at most 2000 characters with a live counter. The list follows new messages unless the reader scrolled
 * up (then a "New messages" button appears).
 */
import { ArrowDownIcon, MessageSquareOffIcon, SendHorizontalIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import ChatMessageItem from './ChatMessageItem.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { CHAT_MAX_LENGTH } from '#shared/schemas/livekit'
import { CHAT_DISABLED_TEXT, useChat } from '~/lib/call/features/chat/useChat'

/** Distance from the bottom (px) that still counts as "following" the conversation. */
const FOLLOW_SLACK = 48

const chat = useChat()
const messages = computed(() => chat.messages.value)
const enabled = computed(() => chat.enabled())

const draft = shallowRef('')
const error = shallowRef<string | null>(null)
const sending = shallowRef(false)
const composing = shallowRef(false)
const list = useTemplateRef<HTMLElement>('list')
const following = shallowRef(true)
const unseen = shallowRef(false)

const length = computed(() => draft.value.length)
const nearLimit = computed(() => length.value > CHAT_MAX_LENGTH - 200)

function atBottom(): boolean {
  const el = list.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK
}

function scrollToBottom() {
  const el = list.value
  if (el) el.scrollTop = el.scrollHeight
  following.value = true
  unseen.value = false
}

function onScroll() {
  following.value = atBottom()
  if (following.value) unseen.value = false
}

watch(
  () => (messages.value.length > 0 ? messages.value[messages.value.length - 1]!.id : null),
  async () => {
    const last = messages.value.at(-1)
    const follow = following.value || last?.own === true
    await nextTick()
    if (follow) scrollToBottom()
    else unseen.value = true
  },
)

onMounted(() => scrollToBottom())

function showName(index: number): boolean {
  const message = messages.value[index]!
  const previous = messages.value[index - 1]
  return !previous || previous.from !== message.from || message.ts - previous.ts > 5 * 60_000
}

async function send() {
  if (sending.value) return
  error.value = null
  sending.value = true
  try {
    const problem = await chat.send(draft.value)
    if (problem) error.value = problem
    else draft.value = ''
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) return
  // Enter confirms an IME candidate instead of sending (keyCode 229 covers Safari's composition end).
  if (event.isComposing || composing.value || event.keyCode === 229) return
  event.preventDefault()
  void send()
}

function onInput(value: string | number) {
  draft.value = String(value).slice(0, CHAT_MAX_LENGTH)
  if (error.value) error.value = null
}
</script>

<template>
  <div class="flex h-full min-h-[18rem] flex-col" data-testid="chat-panel">
    <div class="relative min-h-0 flex-1">
      <ol
        ref="list"
        class="absolute inset-0 flex flex-col gap-1 overflow-y-auto px-3 py-3"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Chat messages"
        data-testid="chat-messages"
        @scroll.passive="onScroll"
      >
        <li v-if="messages.length === 0" class="m-auto max-w-60 text-center text-sm text-muted-foreground">
          Messages are end-to-end encrypted. People who join later don't see earlier messages.
        </li>
        <ChatMessageItem
          v-for="(message, index) in messages"
          :key="message.id"
          :message="message"
          :show-name="showName(index)"
          @retry="chat.retry(message)"
          @dismiss="chat.dismiss(message)"
        />
      </ol>
      <button
        v-if="unseen"
        type="button"
        class="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg"
        data-testid="chat-new-messages"
        @click="scrollToBottom"
      >
        <ArrowDownIcon class="size-3.5" aria-hidden="true" />
        New messages
      </button>
    </div>

    <div class="shrink-0 border-t p-3">
      <p
        v-if="!enabled"
        class="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-muted-foreground"
        data-testid="chat-disabled"
      >
        <MessageSquareOffIcon class="size-4 shrink-0" aria-hidden="true" />
        {{ CHAT_DISABLED_TEXT }}
      </p>
      <form v-else class="flex flex-col gap-1.5" novalidate @submit.prevent="send">
        <div class="flex items-end gap-2">
          <Textarea
            :model-value="draft"
            :maxlength="CHAT_MAX_LENGTH"
            rows="1"
            placeholder="Message everyone"
            aria-label="Message everyone"
            aria-describedby="chat-input-help"
            class="max-h-40 min-h-10 resize-none"
            data-testid="chat-input"
            @update:model-value="onInput"
            @keydown="onKeydown"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          />
          <Button
            type="submit"
            size="icon"
            class="size-10 shrink-0"
            aria-label="Send message"
            :disabled="sending || draft.trim().length === 0"
            data-testid="chat-send"
          >
            <SendHorizontalIcon aria-hidden="true" />
          </Button>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span id="chat-input-help" :class="error ? 'text-red-300' : 'text-muted-foreground'" data-testid="chat-error">
            {{ error ?? 'Enter to send, Shift+Enter for a new line' }}
          </span>
          <span
            :class="cn('shrink-0 tabular-nums', nearLimit ? 'text-amber-300' : 'text-muted-foreground')"
            data-testid="chat-counter"
            >{{ length }}/{{ CHAT_MAX_LENGTH }}</span
          >
        </div>
      </form>
    </div>
  </div>
</template>
