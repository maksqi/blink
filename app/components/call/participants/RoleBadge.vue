<script setup lang="ts">
/** "Host" / "Co-host" / "Guest" pill, on tiles (registry tile badge) and in the participants panel. */
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import type { ParticipantView } from '~/lib/contracts/call'

const props = withDefaults(
  defineProps<{ participant: Pick<ParticipantView, 'role' | 'kind'>; variant?: 'tile' | 'list' }>(),
  { variant: 'tile' },
)

const badges = computed(() => {
  const out: Array<{ id: string; label: string; tone: string }> = []
  if (props.participant.role === 'host') out.push({ id: 'host', label: 'Host', tone: 'bg-primary/90 text-primary-foreground' })
  if (props.participant.role === 'cohost') out.push({ id: 'cohost', label: 'Co-host', tone: 'bg-sky-500/85 text-white' })
  if (props.participant.kind === 'guest') out.push({ id: 'guest', label: 'Guest', tone: 'bg-white/15 text-white/90' })
  return out
})
</script>

<template>
  <span
    v-for="badge in badges"
    :key="badge.id"
    :data-badge="badge.id"
    data-testid="role-badge"
    :class="
      cn(
        'inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[0.6875rem] leading-none font-semibold',
        badge.tone,
        variant === 'tile' && 'shadow-sm',
      )
    "
    >{{ badge.label }}</span
  >
</template>
