<script setup lang="ts">
/**
 * /recordings/[id] (recording-server, Stage 08): plays one recording from the Range-capable file endpoint
 * (`<video controls preload="metadata">`), with its facts, the partial notice, download and delete. Polls every 5 s
 * while the recording is still being recorded or processed.
 */
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  DownloadIcon,
  HardDriveIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { RecordingSummary } from '#shared/schemas/recordings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import DeleteRecordingDialog from '@/components/recordings/DeleteRecordingDialog.vue'
import RecordingMeta, { fileUrl, formatDateTime, isBusy, isPlayable } from '@/components/recordings/RecordingMeta.vue'
import RecordingsNotice from '@/components/recordings/RecordingsNotice.vue'
import RecordingStatusBadge from '@/components/recordings/RecordingStatusBadge.vue'
import { ApiError } from '~/composables/useApi'

const POLL_MS = 5_000

const api = useApi()
const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))

const recording = shallowRef<RecordingSummary | null>(null)
const state = ref<'loading' | 'ready' | 'signin' | 'not-found' | 'error'>('loading')
const errorMessage = ref<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0

definePageMeta({ middleware: 'auth' })
useHead(() => ({ title: recording.value ? `Recording of ${recording.value.roomName}` : 'Recording' }))

async function load(options: { quiet?: boolean } = {}) {
  const current = ++generation
  clearTimeout(timer)
  try {
    const result = await api<{ recording: RecordingSummary }>(`/api/recordings/${encodeURIComponent(id.value)}`)
    if (current !== generation) return
    recording.value = result.recording
    state.value = 'ready'
    if (isBusy(result.recording)) timer = setTimeout(() => void load({ quiet: true }), POLL_MS)
  } catch (error) {
    if (current !== generation) return
    if (error instanceof ApiError && error.status === 401) state.value = 'signin'
    else if (error instanceof ApiError && error.status === 404) state.value = 'not-found'
    else if (options.quiet) timer = setTimeout(() => void load({ quiet: true }), POLL_MS)
    else {
      state.value = 'error'
      errorMessage.value = error instanceof ApiError ? error.message : undefined
    }
  }
}

onMounted(() => void load())
onBeforeUnmount(() => {
  generation++
  clearTimeout(timer)
})
watch(id, () => {
  recording.value = null
  state.value = 'loading'
  void load()
})

const playable = computed(() => (recording.value ? isPlayable(recording.value) : false))

const dialogOpen = ref(false)
const deleting = ref(false)

async function confirmDelete() {
  if (!recording.value) return
  deleting.value = true
  try {
    await api(`/api/recordings/${encodeURIComponent(recording.value.id)}`, { method: 'DELETE' })
    toast.success('Recording deleted')
    dialogOpen.value = false
    await navigateTo('/recordings')
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : 'The recording could not be deleted. Try again.')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div>
    <Button variant="ghost" size="sm" class="-ml-2 mb-4" as-child>
      <NuxtLink to="/recordings">
        <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
        All recordings
      </NuxtLink>
    </Button>

    <div v-if="state === 'loading'" class="space-y-4" aria-busy="true" aria-label="Loading the recording">
      <Skeleton class="h-8 w-64" />
      <Skeleton class="aspect-video w-full rounded-xl" />
    </div>
    <RecordingsNotice v-else-if="state === 'signin'" kind="signin" :next="route.path" />
    <RecordingsNotice v-else-if="state === 'not-found'" kind="not-found" />
    <RecordingsNotice v-else-if="state === 'error'" kind="error" :message="errorMessage" @retry="load()" />

    <template v-else-if="recording">
      <AppPageHeader :title="recording.roomName" :description="formatDateTime(recording.startedAt)">
        <template #actions>
          <RecordingStatusBadge :recording="recording" />
          <Button v-if="playable" variant="outline" as-child>
            <a :href="fileUrl(recording.id, true)" download data-testid="download-recording">
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              Download
            </a>
          </Button>
          <Button
            variant="destructive"
            :disabled="isBusy(recording)"
            data-testid="delete-recording"
            @click="dialogOpen = true"
          >
            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            Delete
          </Button>
        </template>
      </AppPageHeader>

      <div class="space-y-6">
        <Alert v-if="recording.partial" class="border-amber-500/40">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertTitle>Partial recording</AlertTitle>
          <AlertDescription>This recording ended unexpectedly and may be incomplete.</AlertDescription>
        </Alert>

        <video
          v-if="playable"
          :key="recording.id"
          class="aspect-video w-full rounded-xl bg-black"
          :src="fileUrl(recording.id)"
          controls
          preload="metadata"
          playsinline
          data-testid="recording-player"
        >
          Your browser cannot play this video. Download it instead.
        </video>
        <div
          v-else
          class="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border bg-muted/40 p-6 text-center"
        >
          <template v-if="recording.mode === 'local'">
            <HardDriveIcon class="size-8 text-muted-foreground" aria-hidden="true" />
            <p class="font-medium">Saved on the recorder's device</p>
            <p class="max-w-md text-sm text-muted-foreground">
              Local recordings never leave the device they were made on, so there is nothing to play here.
            </p>
          </template>
          <template v-else-if="recording.status === 'failed'">
            <AlertTriangleIcon class="size-8 text-destructive" aria-hidden="true" />
            <p class="font-medium">This recording could not be processed</p>
            <p class="max-w-md text-sm text-muted-foreground">Nothing was kept. You can delete this entry.</p>
          </template>
          <template v-else>
            <LoaderCircleIcon
              class="size-8 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p class="font-medium" aria-live="polite">
              {{
                recording.status === 'recording' ? 'This meeting is still being recorded' : 'Processing the recording'
              }}
            </p>
            <p class="max-w-md text-sm text-muted-foreground">
              This page updates on its own when the recording is ready.
            </p>
          </template>
        </div>

        <RecordingMeta :recording="recording" />
      </div>

      <DeleteRecordingDialog
        v-model:open="dialogOpen"
        :recording="recording"
        :pending="deleting"
        @confirm="confirmDelete"
      />
    </template>
  </div>
</template>
