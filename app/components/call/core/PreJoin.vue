<script setup lang="ts">
/**
 * Pre-join (`<CallPrejoin :session>`): camera preview, mic level, device choice (remembered per kind), the join-muted
 * toggles, the display name for guests, the recording notice and pre-join slots from the feature registries.
 * The tracks opened here are the ones published on join. The Join click starts the join-time measurement and emits
 * `join`; the host page then runs the join request and calls `session.connect(grant)`.
 */
import { CircleAlertIcon, CircleDotIcon, LockKeyholeIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from '@lucide/vue'
import { supportsAudioOutputSelection } from 'livekit-client'
import { computed, onMounted, provide, shallowRef } from 'vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import CallControlButton from './CallControlButton.vue'
import MicLevelMeter from './MicLevelMeter.vue'
import UnsupportedBrowser from './UnsupportedBrowser.vue'
import VideoTrackView from './VideoTrackView.vue'
import { CALL_SESSION_KEY } from '~/lib/call/context-key'
import { CAPTURE_ERROR_TEXT, type DeviceKind } from '~/lib/call/devices'
import { callRegistry } from '~/lib/call/features'
import type { CallSession } from '~/lib/call/session'
import { displayNameSchema } from '#shared/schemas/common'

const props = withDefaults(
  defineProps<{
    session: CallSession
    /** Meeting name. */
    title?: string
    /** `guest`: ask for a name; `fixed`: show `displayName` read-only; `none`: no name row. */
    nameMode?: 'guest' | 'fixed' | 'none'
    displayName?: string
    /** The meeting is being recorded (JoinInfo.recordingActive). */
    recordingActive?: boolean
    /** The host page is running the join request. */
    joining?: boolean
    joinLabel?: string
    /** A join error from the host page (already user-facing text). */
    error?: string | null
  }>(),
  {
    title: undefined,
    nameMode: 'none',
    displayName: '',
    recordingActive: false,
    joining: false,
    joinLabel: 'Join now',
    error: null,
  },
)

const emit = defineEmits<{
  join: [payload: { displayName: string | null }]
  'update:displayName': [value: string]
}>()

provide(CALL_SESSION_KEY, props.session)
const store = props.session.store

const name = shallowRef(props.displayName)
const nameError = shallowRef<string | null>(null)
const speakerSupported = supportsAudioOutputSelection()
const slots = callRegistry.preJoin
const locked = computed(() => store.muteOnJoin)

const preview = computed(() => props.session.previewTrack())
const cameraError = computed(() => (store.media.cameraError ? CAPTURE_ERROR_TEXT.camera[store.media.cameraError] : null))
const micError = computed(() => (store.media.micError ? CAPTURE_ERROR_TEXT.microphone[store.media.micError] : null))

const devices = computed(() => {
  const rows: Array<{ kind: DeviceKind; label: string; id: string }> = [
    { kind: 'videoinput', label: 'Camera', id: 'prejoin-camera' },
    { kind: 'audioinput', label: 'Microphone', id: 'prejoin-microphone' },
  ]
  if (speakerSupported) rows.push({ kind: 'audiooutput', label: 'Speaker', id: 'prejoin-speaker' })
  return rows
})

function deviceValue(kind: DeviceKind) {
  return store.selectedDevice(kind) ?? store.devices[kind][0]?.deviceId ?? ''
}
function selectDevice(kind: DeviceKind, value: unknown) {
  if (typeof value === 'string' && value) void props.session.selectDevice(kind, value)
}

function onName(value: string | number) {
  name.value = String(value)
  nameError.value = null
  emit('update:displayName', name.value)
}

function join() {
  if (props.joining || !props.session.support.ok) return
  let displayName: string | null = null
  if (props.nameMode === 'guest') {
    const parsed = displayNameSchema.safeParse(name.value)
    if (!parsed.success) {
      nameError.value = parsed.error.issues[0]?.message ?? 'Enter a name'
      return
    }
    displayName = parsed.data
  }
  props.session.markJoinClick()
  emit('join', { displayName })
}

onMounted(() => {
  void props.session.startPreview()
})
</script>

<template>
  <TooltipProvider>
    <UnsupportedBrowser v-if="!session.support.ok" :message="store.error?.message ?? ''" />
    <div
      v-else
      class="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center gap-6 px-4 py-6 sm:px-6 md:grid md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-center md:gap-10 md:py-10"
      data-testid="prejoin"
    >
      <section aria-label="Preview" class="flex flex-col gap-3">
        <div class="relative aspect-video w-full overflow-hidden rounded-2xl bg-card shadow-2xl shadow-black/30 ring-1 ring-white/8">
          <VideoTrackView v-if="preview" :track="preview" mirror class="absolute inset-0" data-testid="prejoin-preview" />
          <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <VideoOffIcon class="size-8 text-white/50" aria-hidden="true" />
            <p v-if="cameraError" class="max-w-xs text-white/80">{{ cameraError }}</p>
            <p v-else-if="store.media.cameraBusy">Starting camera…</p>
            <p v-else>Your camera is off</p>
          </div>
          <div class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-linear-to-t from-black/60 to-transparent px-3 pt-8 pb-3">
            <CallControlButton
              label="Microphone"
              :icon="store.media.micOn ? MicIcon : MicOffIcon"
              :pressed="store.media.micOn"
              :tone="store.media.micOn ? 'default' : 'off'"
              :disabled="locked || store.media.micBusy || (!store.media.micOn && Boolean(store.media.micError))"
              :disabled-reason="locked ? 'The host has everyone join muted' : (micError ?? undefined)"
              @click="session.toggleMic()"
            />
            <CallControlButton
              label="Camera"
              :icon="store.media.cameraOn ? VideoIcon : VideoOffIcon"
              :pressed="store.media.cameraOn"
              :tone="store.media.cameraOn ? 'default' : 'off'"
              :disabled="locked || store.media.cameraBusy"
              :disabled-reason="locked ? 'The host has everyone join with the camera off' : undefined"
              @click="session.toggleCamera()"
            />
          </div>
          <MicLevelMeter v-if="store.media.micOn" class="absolute top-3 left-3" />
        </div>
        <p class="flex items-center justify-center gap-1.5 text-xs text-muted-foreground md:justify-start">
          <LockKeyholeIcon class="size-3.5" aria-hidden="true" />
          End-to-end encrypted. The meeting key never leaves your device.
        </p>
      </section>

      <section aria-labelledby="prejoin-title" class="flex flex-col gap-5">
        <div>
          <h1 id="prejoin-title" class="text-2xl font-semibold tracking-tight">Ready to join?</h1>
          <p v-if="title" class="mt-1 truncate text-sm text-muted-foreground">{{ title }}</p>
        </div>

        <Alert v-if="recordingActive" class="border-red-400/30 bg-red-500/10 text-red-100" data-testid="prejoin-recording">
          <CircleDotIcon class="text-red-400" />
          <AlertTitle>This meeting is being recorded</AlertTitle>
          <AlertDescription>Everyone in the meeting can see that it is being recorded.</AlertDescription>
        </Alert>

        <Field v-if="nameMode === 'guest'" :data-invalid="nameError ? true : undefined">
          <FieldLabel for="prejoin-name">Your name</FieldLabel>
          <Input
            id="prejoin-name"
            :model-value="name"
            autocomplete="name"
            maxlength="64"
            placeholder="How others see you"
            :aria-invalid="nameError ? true : undefined"
            @update:model-value="onName"
            @keydown.enter.prevent="join"
          />
          <FieldError v-if="nameError">{{ nameError }}</FieldError>
        </Field>
        <p v-else-if="nameMode === 'fixed' && displayName" class="text-sm text-muted-foreground">
          Joining as <span class="font-medium text-foreground">{{ displayName }}</span>
        </p>

        <div class="flex flex-col gap-3">
          <Field v-for="row in devices" :key="row.kind" class="gap-1.5">
            <FieldLabel :for="row.id" class="text-xs text-muted-foreground">{{ row.label }}</FieldLabel>
            <Select :model-value="deviceValue(row.kind)" @update:model-value="selectDevice(row.kind, $event)">
              <SelectTrigger :id="row.id" class="w-full" :disabled="store.devices[row.kind].length === 0">
                <SelectValue :placeholder="`No ${row.label.toLowerCase()} found`" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="device in store.devices[row.kind]" :key="device.deviceId" :value="device.deviceId">
                  {{ device.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <component :is="slot.component" v-for="slot in slots" :key="slot.id" />

        <p v-if="locked" class="text-sm text-muted-foreground">The host has everyone join with microphone and camera off.</p>
        <p v-if="micError" class="flex items-start gap-2 text-sm text-amber-200">
          <CircleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {{ micError }}
        </p>

        <Alert v-if="error" variant="destructive" data-testid="prejoin-error">
          <CircleAlertIcon />
          <AlertTitle>Couldn't join</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Button size="lg" class="h-12 w-full text-base" :disabled="joining" data-testid="join-button" @click="join">
          <Spinner v-if="joining" />
          {{ joining ? 'Joining…' : joinLabel }}
        </Button>
      </section>
    </div>
  </TooltipProvider>
</template>
