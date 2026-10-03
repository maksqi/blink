<script setup lang="ts">
/** Per-tile menu: pin (local only, feeds the layout and the subscription priority) and local playback volume. */
import { EllipsisVerticalIcon, PinIcon, PinOffIcon, Volume2Icon, VolumeXIcon } from '@lucide/vue'
import { computed } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { useCallSession } from '~/composables/call'
import type { ParticipantView } from '~/lib/contracts/call'

const props = defineProps<{ participant: ParticipantView }>()

const session = useCallSession()
const store = session.store

const pinned = computed(() => store.pinned === props.participant.identity)
const volume = computed(() => Math.round((store.localVolumes[props.participant.identity] ?? 1) * 100))

function setVolume(value: number[] | undefined) {
  const next = value?.[0]
  if (typeof next === 'number') session.setLocalVolume(props.participant.identity, next / 100)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :aria-label="`Options for ${participant.name}`"
        class="inline-flex size-7 items-center justify-center rounded-md bg-black/50 max-sm:size-11 pointer-coarse:size-11 text-white opacity-100 transition-opacity hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring sm:opacity-0 sm:group-hover/tile:opacity-100 sm:group-focus-within/tile:opacity-100 data-[state=open]:opacity-100"
      >
        <EllipsisVerticalIcon class="size-4" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuLabel class="truncate">{{ participant.name }}</DropdownMenuLabel>
      <DropdownMenuItem @select="session.togglePin(participant.identity)">
        <PinOffIcon v-if="pinned" aria-hidden="true" />
        <PinIcon v-else aria-hidden="true" />
        {{ pinned ? 'Unpin' : 'Pin for me' }}
      </DropdownMenuItem>
      <template v-if="!participant.isLocal">
        <DropdownMenuSeparator />
        <div class="flex flex-col gap-2 px-2 py-2" @keydown.stop>
          <div class="flex items-center justify-between text-sm">
            <span class="flex items-center gap-2">
              <VolumeXIcon v-if="volume === 0" class="size-4 text-muted-foreground" aria-hidden="true" />
              <Volume2Icon v-else class="size-4 text-muted-foreground" aria-hidden="true" />
              Volume for me
            </span>
            <span class="text-muted-foreground tabular-nums">{{ volume }}%</span>
          </div>
          <Slider
            :model-value="[volume]"
            :min="0"
            :max="100"
            :step="5"
            :aria-label="`Volume of ${participant.name} for me`"
            @update:model-value="setVolume"
          />
          <p v-if="participant.volumeForEveryone < 100" class="text-xs text-muted-foreground">
            A host set their volume to {{ participant.volumeForEveryone }}% for everyone.
          </p>
        </div>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
