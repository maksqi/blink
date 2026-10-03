<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { NuxtLink } from '#components'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    /** Link target; `false` renders the logo without a link. */
    to?: string | false
    /** Mark only, without the wordmark. */
    iconOnly?: boolean
    /** Classes for the mark, e.g. its size. */
    markClass?: HTMLAttributes['class']
    class?: HTMLAttributes['class']
  }>(),
  { to: '/', iconOnly: false, markClass: undefined, class: undefined },
)
</script>

<template>
  <component
    :is="props.to ? NuxtLink : 'span'"
    :to="props.to || undefined"
    :prefetch-on="props.to ? 'interaction' : undefined"
    :aria-label="props.to ? 'blinq home' : undefined"
    :class="cn('inline-flex shrink-0 items-center gap-2 rounded-lg text-foreground', props.class)"
  >
    <!-- The mark is a lowercase "q" that doubles as a camera lens. -->
    <svg viewBox="0 0 32 32" :class="cn('size-7 shrink-0', props.markClass)" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" class="fill-primary" />
      <circle cx="14" cy="14.5" r="6" fill="none" stroke-width="3.2" class="stroke-primary-foreground" />
      <path d="M20 9.5v15" fill="none" stroke-width="3.2" stroke-linecap="round" class="stroke-primary-foreground" />
      <circle cx="24.6" cy="7.6" r="1.9" class="fill-primary-foreground/70" />
    </svg>
    <span v-if="!props.iconOnly" class="text-[1.2rem] leading-none font-[650] tracking-[-0.03em]">blinq</span>
  </component>
</template>
