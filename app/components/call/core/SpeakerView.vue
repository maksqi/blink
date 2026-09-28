<script setup lang="ts">
/**
 * Speaker and presentation view: one stage (pinned participant, else a remote screen share, else the active speaker)
 * plus a scrolling filmstrip. Strip tiles are small, so the policy requests low simulcast layers for them.
 */
import { MonitorUpIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, shallowRef } from 'vue'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ParticipantTile from './ParticipantTile.vue'
import { useCallSession } from '~/composables/call'
import { computeSpeakerLayout, fitBox } from '~/lib/layout/speaker'
import type { ParticipantView } from '~/lib/contracts/call'

const props = defineProps<{ participants: ParticipantView[]; phone: boolean }>()

const session = useCallSession()
const store = session.store
const container = shallowRef<HTMLElement | null>(null)
const { width, height } = useElementSize(container)

interface StageItem {
  participant: ParticipantView
  source: 'camera' | 'screen_share'
}

const stage = computed<StageItem | 'self-presenting' | null>(() => {
  const all = props.participants
  const pinned = store.pinned ? all.find((p) => p.identity === store.pinned) : undefined
  if (pinned) return { participant: pinned, source: 'camera' }
  const presenter = all.find((p) => !p.isLocal && p.screenSharing)
  if (presenter) return { participant: presenter, source: 'screen_share' }
  if (store.screenShare.active) return 'self-presenting'
  const speaker = store.activeSpeaker ? all.find((p) => p.identity === store.activeSpeaker) : undefined
  const fallback = speaker ?? all.find((p) => !p.isLocal) ?? all[0]
  return fallback ? { participant: fallback, source: 'camera' } : null
})

const strip = computed(() => {
  const current = stage.value
  if (!current || current === 'self-presenting') return props.participants
  // A presenter keeps their camera tile in the strip; everyone else except the stage camera is listed.
  if (current.source === 'screen_share') return props.participants
  return props.participants.filter((p) => p.identity !== current.participant.identity)
})

const layout = computed(() =>
  computeSpeakerLayout({ width: width.value, height: height.value, stripCount: strip.value.length, phone: props.phone }),
)
const stageBox = computed(() => fitBox(layout.value.stage.width, layout.value.stage.height))
const vertical = computed(() => layout.value.strip.orientation === 'vertical')
</script>

<template>
  <div
    ref="container"
    :class="cn('flex size-full min-h-0 gap-2', vertical ? 'flex-row' : 'flex-col')"
    data-testid="speaker-view"
  >
    <div class="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <div
        v-if="stage === 'self-presenting'"
        class="flex flex-col items-center justify-center gap-3 rounded-xl bg-card/60 p-6 text-center ring-1 ring-white/6"
        :style="{ width: `${stageBox.width}px`, height: `${stageBox.height}px` }"
        data-testid="self-presenting"
      >
        <MonitorUpIcon class="size-8 text-primary" aria-hidden="true" />
        <p class="text-sm font-medium">You're presenting your screen</p>
        <Button size="sm" variant="secondary" @click="session.stopScreenShare()">Stop presenting</Button>
      </div>
      <ParticipantTile
        v-else-if="stage"
        :key="`${stage.participant.identity}:${stage.source}`"
        :participant="stage.participant"
        :source="stage.source"
        priority
        variant="stage"
        :style="{ width: `${stageBox.width}px`, height: `${stageBox.height}px` }"
      />
    </div>
    <div
      v-if="strip.length > 0"
      :class="
        cn(
          'flex shrink-0 gap-2 [scrollbar-width:thin]',
          vertical ? 'flex-col overflow-y-auto overflow-x-hidden' : 'flex-row overflow-x-auto overflow-y-hidden',
        )
      "
      :style="vertical ? { width: `${layout.strip.tileWidth}px` } : { height: `${layout.strip.tileHeight}px` }"
      data-testid="filmstrip"
    >
      <ParticipantTile
        v-for="participant in strip"
        :key="participant.identity"
        :participant="participant"
        variant="strip"
        class="shrink-0"
        :style="{ width: `${layout.strip.tileWidth}px`, height: `${layout.strip.tileHeight}px` }"
      />
    </div>
  </div>
</template>
