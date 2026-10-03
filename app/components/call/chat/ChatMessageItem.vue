<script setup lang="ts">
/**
 * One chat message. Text-only: segments from `linkify()` render as text or as `<a>` for http(s) links; never v-html,
 * never markdown. Bidi controls are already removed by `linkify()`.
 */
import { CircleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '~/lib/call/features/chat/chat-store'
import { linkify, stripBidiControls } from '~/lib/call/features/chat/linkify'

const props = defineProps<{ message: ChatMessage; showName: boolean }>()
defineEmits<{ retry: []; dismiss: [] }>()

const segments = computed(() => linkify(props.message.text))
const name = computed(() => stripBidiControls(props.message.name))
const time = computed(() =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(props.message.ts)),
)
</script>

<template>
  <li
    :class="cn('flex flex-col gap-0.5', message.own ? 'items-end' : 'items-start', showName && 'mt-2')"
    data-testid="chat-message"
    :data-own="message.own || undefined"
    :data-status="message.status"
  >
    <div v-if="showName" class="flex max-w-full items-baseline gap-2 px-1 text-xs text-muted-foreground">
      <span class="truncate font-medium text-foreground/85" data-testid="chat-message-sender">{{
        message.own ? 'You' : name
      }}</span>
      <time :datetime="new Date(message.ts).toISOString()" class="shrink-0 tabular-nums">{{ time }}</time>
    </div>
    <div
      :class="
        cn(
          'max-w-[92%] rounded-2xl px-3 py-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]',
          message.own ? 'rounded-br-md bg-primary/20 text-foreground' : 'rounded-bl-md bg-white/8',
          message.status === 'failed' && 'opacity-70 ring-1 ring-red-400/50',
        )
      "
      data-testid="chat-message-text"
    >
      <template v-for="(segment, index) in segments" :key="index">
        <a
          v-if="segment.kind === 'link'"
          :href="segment.href"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary underline underline-offset-2 hover:no-underline"
          data-testid="chat-link"
          >{{ segment.text }}</a
        >
        <template v-else>{{ segment.text }}</template>
      </template>
    </div>
    <div
      v-if="message.status === 'failed'"
      class="flex items-center gap-2 px-1 text-xs text-red-300"
      data-testid="chat-message-failed"
    >
      <CircleAlertIcon class="size-3.5" aria-hidden="true" />
      Not sent.
      <button type="button" class="font-medium underline underline-offset-2" data-testid="chat-retry" @click="$emit('retry')">
        Retry
      </button>
      <button type="button" class="text-muted-foreground underline underline-offset-2" @click="$emit('dismiss')">
        Delete
      </button>
    </div>
  </li>
</template>
