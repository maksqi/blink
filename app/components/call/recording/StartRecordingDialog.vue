<script setup lang="ts">
/**
 * Where the recording goes: the server (readable by the server and its admins, docs/SECURITY.md §6) or this device
 * only (stays end-to-end encrypted). Emits `start` synchronously from the click, so the recorder's AudioContext can
 * start inside the user gesture.
 */
import { CircleIcon } from '@lucide/vue'
import { shallowRef, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { EVERYONE_SEES, LOCAL_DISCLOSURE, SERVER_DISCLOSURE } from '~/lib/recording/announce'
import type { RecordingMode } from '~/lib/recording/controller'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ start: [mode: RecordingMode] }>()

const mode = shallowRef<RecordingMode>('server')
watch(open, (value) => {
  if (value) mode.value = 'server'
})

function start() {
  emit('start', mode.value)
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg" data-testid="start-recording-dialog">
      <DialogHeader>
        <DialogTitle>Record this meeting</DialogTitle>
        <DialogDescription>Choose where the recording is saved.</DialogDescription>
      </DialogHeader>
      <RadioGroup v-model="mode" aria-label="Where to save the recording" class="gap-3">
        <FieldLabel for="recording-mode-server">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Record to the server</FieldTitle>
              <FieldDescription>{{ SERVER_DISCLOSURE }} {{ EVERYONE_SEES }}</FieldDescription>
            </FieldContent>
            <RadioGroupItem id="recording-mode-server" value="server" data-testid="recording-mode-server" />
          </Field>
        </FieldLabel>
        <FieldLabel for="recording-mode-local">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Save to this device only</FieldTitle>
              <FieldDescription>{{ LOCAL_DISCLOSURE }} {{ EVERYONE_SEES }}</FieldDescription>
            </FieldContent>
            <RadioGroupItem id="recording-mode-local" value="local" data-testid="recording-mode-local" />
          </Field>
        </FieldLabel>
      </RadioGroup>
      <DialogFooter>
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button variant="destructive" data-testid="start-recording" @click="start">
          <CircleIcon class="fill-current" data-icon="inline-start" aria-hidden="true" />
          Start recording
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
