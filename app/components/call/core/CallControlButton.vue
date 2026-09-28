<script setup lang="ts">
/**
 * Round control-bar button with a tooltip. Toggles expose `aria-pressed`. After a pointer click the button gives up
 * focus, so Space goes back to push to talk instead of pressing the button again.
 */
import type { Component } from 'vue'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    label: string
    icon: Component
    /** Toggle state; omit for plain buttons. */
    pressed?: boolean
    tone?: 'default' | 'off' | 'active' | 'danger'
    disabled?: boolean
    /** Tooltip text while disabled (why it is disabled). */
    disabledReason?: string
    shortcut?: string
    /** Visible text next to the icon (wide screens only). */
    text?: string
    class?: string
  }>(),
  {
    pressed: undefined,
    tone: 'default',
    disabled: false,
    disabledReason: undefined,
    shortcut: undefined,
    text: undefined,
    class: undefined,
  },
)

defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ click: [event: MouseEvent] }>()

function onClick(event: MouseEvent) {
  if (props.disabled) return
  emit('click', event)
  if (event.detail > 0) (event.currentTarget as HTMLElement | null)?.blur()
}

const toneClass = {
  default: 'bg-white/10 text-white hover:bg-white/18',
  off: 'bg-[oklch(0.58_0.19_25)] text-white hover:bg-[oklch(0.62_0.19_25)]',
  active: 'bg-primary text-primary-foreground hover:bg-primary/85',
  danger: 'bg-[oklch(0.58_0.2_25)] text-white hover:bg-[oklch(0.63_0.2_25)]',
} as const
</script>

<template>
  <Tooltip :delay-duration="300">
    <TooltipTrigger as-child>
      <button
        v-bind="$attrs"
        type="button"
        :aria-label="label"
        :aria-pressed="pressed === undefined ? undefined : pressed"
        :aria-disabled="disabled || undefined"
        :data-tone="tone"
        :class="
          cn(
            'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            toneClass[tone],
            disabled && 'cursor-not-allowed opacity-45 hover:bg-white/10',
            props.class,
          )
        "
        @click="onClick"
      >
        <component :is="icon" class="size-5" aria-hidden="true" />
        <span v-if="text" class="hidden xl:inline">{{ text }}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" :side-offset="8">
      <span>{{ disabled && disabledReason ? disabledReason : label }}</span>
      <Kbd v-if="shortcut && !disabled">{{ shortcut }}</Kbd>
    </TooltipContent>
  </Tooltip>
</template>
