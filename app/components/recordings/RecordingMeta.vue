<script lang="ts">
/**
 * Facts about one recording (date, duration, size, expiry, recorder, resolution) plus the display helpers every
 * recording view shares. The helpers live in this SFC's plain <script> block because Nuxt would register a loose
 * .ts file under components/ as a component.
 */
import type { RecordingSummary } from '#shared/schemas/recordings'

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

export function formatDate(iso: string | null): string {
  return iso ? dateOnly.format(new Date(iso)) : '—'
}

/** Still being recorded or processed: the list keeps polling and deleting is not possible yet. */
export function isBusy(recording: Pick<RecordingSummary, 'status'>): boolean {
  return recording.status === 'recording' || recording.status === 'processing'
}

/** Only finished server recordings have a file to play or download. */
export function isPlayable(recording: Pick<RecordingSummary, 'status' | 'mode'>): boolean {
  return recording.mode === 'server' && recording.status === 'ready'
}

export function fileUrl(id: string, download = false): string {
  return `/api/recordings/${encodeURIComponent(id)}/file${download ? '?download=1' : ''}`
}
</script>

<script setup lang="ts">
const props = defineProps<{ recording: RecordingSummary }>()

const facts = computed(() => {
  const r = props.recording
  const local = r.mode === 'local'
  return [
    { label: 'Recorded', value: formatDateTime(r.startedAt) },
    { label: 'Duration', value: formatDuration(r.durationMs) },
    { label: 'Size', value: local ? 'Not stored' : formatSize(r.sizeBytes) },
    { label: 'Deleted on', value: local ? '—' : formatDate(r.expiresAt) },
    { label: 'Recorded by', value: r.createdBy.displayName },
    { label: 'Resolution', value: r.width && r.height ? `${r.width} × ${r.height}` : '—' },
  ]
})
</script>

<template>
  <dl class="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
    <div v-for="fact in facts" :key="fact.label" class="min-w-0">
      <dt class="text-muted-foreground">{{ fact.label }}</dt>
      <dd class="mt-0.5 truncate font-medium tabular-nums">{{ fact.value }}</dd>
    </div>
  </dl>
</template>
