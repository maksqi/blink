<script setup lang="ts">
/** Settings section "Devices": camera, microphone and (where supported) speaker. Choices are remembered per kind. */
import { supportsAudioOutputSelection } from 'livekit-client'
import { computed } from 'vue'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MicLevelMeter from './MicLevelMeter.vue'
import { useCallSession } from '~/composables/call'
import { CAPTURE_ERROR_TEXT, type DeviceKind } from '~/lib/call/devices'

const session = useCallSession()
const store = session.store
const speakerSupported = supportsAudioOutputSelection()

const rows = computed(() => {
  const list: Array<{ kind: DeviceKind; label: string; id: string; error: string | null }> = [
    {
      kind: 'videoinput',
      label: 'Camera',
      id: 'device-camera',
      error: store.media.cameraError ? CAPTURE_ERROR_TEXT.camera[store.media.cameraError] : null,
    },
    {
      kind: 'audioinput',
      label: 'Microphone',
      id: 'device-microphone',
      error: store.media.micError ? CAPTURE_ERROR_TEXT.microphone[store.media.micError] : null,
    },
  ]
  if (speakerSupported) list.push({ kind: 'audiooutput', label: 'Speaker', id: 'device-speaker', error: null })
  return list
})

function valueFor(kind: DeviceKind): string {
  return store.selectedDevice(kind) ?? store.devices[kind][0]?.deviceId ?? ''
}

function select(kind: DeviceKind, value: unknown) {
  if (typeof value === 'string' && value) void session.selectDevice(kind, value)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <Field v-for="row in rows" :key="row.kind">
      <FieldLabel :for="row.id">{{ row.label }}</FieldLabel>
      <Select :model-value="valueFor(row.kind)" @update:model-value="select(row.kind, $event)">
        <SelectTrigger :id="row.id" class="w-full" :disabled="store.devices[row.kind].length === 0">
          <SelectValue :placeholder="`No ${row.label.toLowerCase()} found`" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="device in store.devices[row.kind]" :key="device.deviceId" :value="device.deviceId">
            {{ device.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <MicLevelMeter v-if="row.kind === 'audioinput'" class="mt-1" :bars="24" />
      <FieldDescription v-if="row.error" class="text-destructive">{{ row.error }}</FieldDescription>
    </Field>
  </div>
</template>
