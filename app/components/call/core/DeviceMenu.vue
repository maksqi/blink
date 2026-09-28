<script setup lang="ts">
/**
 * Device picker next to the mic or camera button. The microphone menu also lists speakers, but only where the
 * browser supports output selection (`supportsAudioOutputSelection()`: not Safari, iOS or Android).
 */
import { ChevronUpIcon } from '@lucide/vue'
import { supportsAudioOutputSelection } from 'livekit-client'
import { computed } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCallSession, useCallUi } from '~/composables/call'
import type { DeviceKind } from '~/lib/call/devices'

const props = defineProps<{ kind: 'camera' | 'microphone' }>()

const session = useCallSession()
const ui = useCallUi()
const store = session.store

const inputKind = computed<DeviceKind>(() => (props.kind === 'camera' ? 'videoinput' : 'audioinput'))
const inputs = computed(() => store.devices[inputKind.value])
const outputs = computed(() => (props.kind === 'microphone' && supportsAudioOutputSelection() ? store.devices.audiooutput : []))
const selectedInput = computed(() => store.selectedDevice(inputKind.value) ?? '')
const selectedOutput = computed(() => store.outputDevice ?? outputs.value[0]?.deviceId ?? '')

function selectInput(value: unknown) {
  if (typeof value === 'string' && value) void session.selectDevice(inputKind.value, value)
}
function selectOutput(value: unknown) {
  if (typeof value === 'string' && value) void session.selectDevice('audiooutput', value)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :aria-label="kind === 'camera' ? 'Camera settings' : 'Microphone and speaker settings'"
        class="hidden h-11 w-7 shrink-0 items-center justify-center rounded-r-full bg-white/10 min-[480px]:inline-flex text-white/85 transition-colors hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronUpIcon class="size-4" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" :side-offset="8" class="w-72 max-w-[calc(100vw-2rem)]">
      <DropdownMenuLabel>{{ kind === 'camera' ? 'Camera' : 'Microphone' }}</DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="selectedInput" @update:model-value="selectInput">
        <DropdownMenuRadioItem v-for="device in inputs" :key="device.deviceId" :value="device.deviceId">
          <span class="truncate">{{ device.label }}</span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <p v-if="inputs.length === 0" class="px-2 py-1.5 text-sm text-muted-foreground">
        {{ kind === 'camera' ? 'No camera found' : 'No microphone found' }}
      </p>
      <template v-if="outputs.length > 0">
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Speaker</DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="selectedOutput" @update:model-value="selectOutput">
          <DropdownMenuRadioItem v-for="device in outputs" :key="device.deviceId" :value="device.deviceId">
            <span class="truncate">{{ device.label }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="ui.settingsOpen.value = true">Audio and video settings</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
