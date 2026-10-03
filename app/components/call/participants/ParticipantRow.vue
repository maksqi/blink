<script setup lang="ts">
/** One person in the participants panel: name, role badges, media, speaking, connection, hand, and their actions. */
import {
  HandIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  PencilIcon,
  ShieldAlertIcon,
  VideoIcon,
  VideoOffIcon,
} from '@lucide/vue'
import { computed, shallowRef } from 'vue'
import RenameDialog from './RenameDialog.vue'
import RoleBadge from './RoleBadge.vue'
import ConnectionQualityIcon from '~/components/call/core/ConnectionQualityIcon.vue'
import ParticipantActionsMenu from '~/components/call/host/ParticipantActionsMenu.vue'
import { cn } from '@/lib/utils'
import { useCall } from '~/composables/call'
import { callActions } from '~/lib/call/features/host-actions/state'
import type { ParticipantView } from '~/lib/contracts/call'
import { initials } from '~/lib/shell/initials'

const props = defineProps<{ participant: ParticipantView }>()

const ctx = useCall()
const renameOpen = shallowRef(false)
const label = computed(() => (props.participant.isLocal ? `${props.participant.name} (you)` : props.participant.name))

async function renameSelf(displayName: string): Promise<boolean> {
  return (await callActions(ctx).renameSelf(displayName)).ok
}
</script>

<template>
  <li
    class="group/row flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/4"
    data-testid="participant-row"
    :data-identity="participant.identity"
    :data-role="participant.role"
  >
    <span
      :class="
        cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold ring-2 ring-transparent transition-shadow',
          participant.isSpeaking && 'ring-primary',
        )
      "
      aria-hidden="true"
      >{{ initials(participant.name) }}</span
    >
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-sm font-medium" data-testid="participant-name">{{ label }}</span>
        <RoleBadge :participant="participant" variant="list" />
      </div>
      <p
        v-if="!participant.mediaEncrypted"
        class="flex items-center gap-1 text-xs text-red-300"
        data-testid="participant-media-blocked"
      >
        <ShieldAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
        Media blocked: not encrypted
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <HandIcon
        v-if="participant.handRaisedAt"
        class="size-4 text-amber-300"
        role="img"
        aria-label="Hand raised"
        data-testid="participant-hand"
      />
      <MonitorUpIcon
        v-if="participant.screenSharing"
        class="size-4 text-primary"
        role="img"
        aria-label="Sharing screen"
      />
      <VideoIcon v-if="participant.cameraEnabled" class="size-4" role="img" aria-label="Camera on" />
      <VideoOffIcon v-else class="size-4 opacity-60" role="img" aria-label="Camera off" />
      <MicIcon
        v-if="participant.micEnabled"
        :class="cn('size-4', participant.isSpeaking && 'text-primary')"
        role="img"
        aria-label="Microphone on"
        data-testid="participant-mic"
        data-state="on"
      />
      <MicOffIcon
        v-else
        class="size-4 text-red-300"
        role="img"
        aria-label="Microphone off"
        data-testid="participant-mic"
        data-state="off"
      />
      <ConnectionQualityIcon v-if="!participant.isLocal" :quality="participant.connectionQuality" />
    </div>
    <button
      v-if="participant.isLocal"
      type="button"
      class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      aria-label="Rename yourself"
      title="Rename"
      data-testid="rename-self"
      @click="renameOpen = true"
    >
      <PencilIcon class="size-4" aria-hidden="true" />
    </button>
    <ParticipantActionsMenu v-else :participant="participant" />

    <RenameDialog
      v-if="participant.isLocal"
      v-model:open="renameOpen"
      title="Change your name"
      description="Everyone in the meeting sees the new name."
      :initial-name="participant.name"
      :submit="renameSelf"
    />
  </li>
</template>
