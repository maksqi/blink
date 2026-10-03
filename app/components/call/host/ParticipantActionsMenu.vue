<script setup lang="ts">
/**
 * Moderation menu for one participant (participants panel rows and the moderator tile badge). The items come from
 * `participantMenu()` (gated by `canPerform` plus state); the server enforces every action. Nothing changes
 * optimistically: LiveKit delivers the new state (mute, attributes, names) a moment after the API returns.
 */
import {
  EllipsisVerticalIcon,
  HandIcon,
  MicIcon,
  MicOffIcon,
  MonitorOffIcon,
  PencilIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  UserXIcon,
  VideoIcon,
  VideoOffIcon,
  Volume2Icon,
} from '@lucide/vue'
import { computed, shallowRef, watch, type Component } from 'vue'
import { toast } from 'vue-sonner'
import RenameDialog from '../participants/RenameDialog.vue'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useCall } from '~/composables/call'
import { participantMenu, type MenuItem, type MenuItemId } from '~/lib/call/features/host-actions/menu'
import { afterRemoval } from '~/lib/call/features/host-actions/removal'
import { callActions } from '~/lib/call/features/host-actions/state'
import { participantInfoStore } from '~/lib/call/features/participants/useParticipantInfo'
import type { ParticipantView } from '~/lib/contracts/call'

const props = withDefaults(defineProps<{ participant: ParticipantView; variant?: 'row' | 'tile' }>(), {
  variant: 'row',
})

const ctx = useCall()
const actions = callActions(ctx)
const info = participantInfoStore(ctx)

const actor = computed(() => {
  const self = ctx.self.value
  return self ? { identity: self.identity, role: self.role, kind: self.kind } : null
})
const targetInfo = computed(() => info.byIdentity.value.get(props.participant.identity) ?? null)
const items = computed(() => (actor.value ? participantMenu(actor.value, props.participant, targetInfo.value) : []))
const groups = computed(() => {
  const out: MenuItem[][] = []
  for (const item of items.value) {
    const last = out.at(-1)
    if (last && last[0]!.group === item.group) last.push(item)
    else out.push([item])
  }
  return out
})

const ICONS: Record<MenuItemId, Component> = {
  'mute-microphone': MicOffIcon,
  'stop-camera': VideoOffIcon,
  'stop-screen-share': MonitorOffIcon,
  'ask-unmute': MicIcon,
  'allow-microphone': MicIcon,
  'revoke-microphone': MicOffIcon,
  'allow-camera': VideoIcon,
  'revoke-camera': VideoOffIcon,
  volume: Volume2Icon,
  rename: PencilIcon,
  'make-cohost': ShieldCheckIcon,
  'remove-cohost': ShieldOffIcon,
  'lower-hand': HandIcon,
  remove: UserXIcon,
}

const menuOpen = shallowRef(false)
const renameOpen = shallowRef(false)
const removeOpen = shallowRef(false)
const busy = shallowRef(false)
const removing = shallowRef(false)

const serverVolume = computed(() => targetInfo.value?.volumeLevel ?? props.participant.volumeForEveryone)
const volume = shallowRef(serverVolume.value)
watch(serverVolume, (value) => (volume.value = value))

const target = computed(() => ({ identity: props.participant.identity, name: props.participant.name }))

async function run(id: MenuItemId) {
  const t = target.value
  busy.value = true
  try {
    switch (id) {
      case 'mute-microphone':
        await actions.mute(t, 'microphone')
        break
      case 'stop-camera':
        await actions.mute(t, 'camera')
        break
      case 'stop-screen-share':
        await actions.mute(t, 'screen_share')
        break
      case 'ask-unmute':
        if ((await actions.askUnmute(t)).ok) toast.success(`Asked ${t.name} to unmute`, { position: 'top-center' })
        break
      case 'allow-microphone':
        await actions.setPermissions(t, { microphone: true })
        break
      case 'revoke-microphone':
        await actions.setPermissions(t, { microphone: false })
        break
      case 'allow-camera':
        await actions.setPermissions(t, { camera: true })
        break
      case 'revoke-camera':
        await actions.setPermissions(t, { camera: false })
        break
      case 'make-cohost':
        await actions.setRole(t, 'cohost')
        break
      case 'remove-cohost':
        await actions.setRole(t, 'participant')
        break
      case 'lower-hand':
        await actions.lowerHand(t)
        break
      case 'rename':
        renameOpen.value = true
        break
      case 'remove':
        removeOpen.value = true
        break
      case 'volume':
        break
    }
  } finally {
    busy.value = false
  }
}

function onVolumeInput(value: number[] | undefined) {
  if (typeof value?.[0] === 'number') volume.value = value[0]
}

async function commitVolume(value: number[] | undefined) {
  const level = value?.[0]
  if (typeof level !== 'number' || level === serverVolume.value) return
  const result = await actions.setVolume(target.value, level)
  if (!result.ok) volume.value = serverVolume.value
}

async function rename(displayName: string): Promise<boolean> {
  return (await actions.rename(target.value, displayName)).ok
}

async function confirmRemove() {
  removing.value = true
  try {
    const result = await actions.remove(target.value)
    removeOpen.value = false
    if (result.ok) afterRemoval(ctx)
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <template v-if="items.length > 0">
    <DropdownMenu v-model:open="menuOpen" :modal="false">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          :aria-label="`Moderate ${participant.name}`"
          data-testid="participant-actions"
          :data-identity="participant.identity"
          :class="
            cn(
              'inline-flex shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring',
              variant === 'tile'
                ? 'size-7 bg-black/50 text-white transition-opacity hover:bg-black/70 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-focus-within/tile:opacity-100 sm:group-hover/tile:opacity-100'
                : 'size-8 text-muted-foreground hover:bg-white/8 hover:text-foreground',
            )
          "
        >
          <Spinner v-if="busy" class="size-4" />
          <EllipsisVerticalIcon v-else class="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-64" data-testid="participant-actions-menu">
        <DropdownMenuLabel class="truncate">{{ participant.name }}</DropdownMenuLabel>
        <template v-for="(group, index) in groups" :key="group[0]!.group">
          <DropdownMenuSeparator v-if="index > 0" />
          <template v-for="item in group" :key="item.id">
            <div v-if="item.id === 'volume'" class="flex flex-col gap-2 px-2 py-2" data-action="volume" @keydown.stop>
              <div class="flex items-center justify-between text-sm">
                <span class="flex items-center gap-2">
                  <Volume2Icon class="size-4 text-muted-foreground" aria-hidden="true" />
                  {{ item.label }}
                </span>
                <span class="text-muted-foreground tabular-nums" data-testid="volume-value">{{ volume }}%</span>
              </div>
              <Slider
                :model-value="[volume]"
                :min="0"
                :max="100"
                :step="5"
                :aria-label="`Volume of ${participant.name} for everyone`"
                data-testid="volume-slider"
                @update:model-value="onVolumeInput"
                @value-commit="commitVolume"
              />
            </div>
            <DropdownMenuItem
              v-else
              :data-action="item.id"
              :variant="item.destructive ? 'destructive' : 'default'"
              :disabled="busy"
              @select="run(item.id)"
            >
              <component :is="ICONS[item.id]" aria-hidden="true" />
              {{ item.label }}
            </DropdownMenuItem>
          </template>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <RenameDialog
      v-model:open="renameOpen"
      :title="`Rename ${participant.name}`"
      description="Everyone in the meeting sees the new name."
      :initial-name="participant.name"
      :submit="rename"
    />

    <AlertDialog v-model:open="removeOpen">
      <AlertDialogContent data-testid="remove-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {{ participant.name }}?</AlertDialogTitle>
          <AlertDialogDescription>They cannot rejoin this meeting.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="removing">Cancel</AlertDialogCancel>
          <Button variant="destructive" :disabled="removing" data-testid="remove-confirm" @click="confirmRemove">
            <Spinner v-if="removing" />
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </template>
</template>
