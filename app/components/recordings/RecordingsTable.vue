<script setup lang="ts">
/**
 * Recording list: room, date, duration, size, status and actions (play, download, delete). Local-only rows have no
 * file ("Saved on the recorder's device"); busy rows cannot be played or deleted yet. Admin views add the recorder.
 */
import { DownloadIcon, PlayIcon, Trash2Icon } from '@lucide/vue'
import type { RecordingSummary } from '#shared/schemas/recordings'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { fileUrl, formatDateTime, formatDuration, formatSize, isBusy, isPlayable } from './RecordingMeta.vue'
import RecordingStatusBadge from './RecordingStatusBadge.vue'

const props = defineProps<{
  items: RecordingSummary[]
  /** Admin view: every recording, with the recorder. Busy rows can be deleted too. */
  admin?: boolean
}>()
const emit = defineEmits<{ delete: [recording: RecordingSummary] }>()

function canDelete(recording: RecordingSummary): boolean {
  return props.admin || !isBusy(recording)
}
</script>

<template>
  <TooltipProvider>
    <Table data-testid="recordings-table">
      <TableHeader>
        <TableRow>
          <TableHead>Room</TableHead>
          <TableHead class="hidden md:table-cell">Recorded</TableHead>
          <TableHead v-if="admin" class="hidden lg:table-cell">Recorded by</TableHead>
          <TableHead class="hidden sm:table-cell">Duration</TableHead>
          <TableHead class="hidden sm:table-cell">Size</TableHead>
          <TableHead class="hidden sm:table-cell">Status</TableHead>
          <TableHead class="text-right"><span class="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="recording in items" :key="recording.id" :data-recording-id="recording.id">
          <TableCell class="max-w-56 min-w-0">
            <NuxtLink
              :to="`/recordings/${recording.id}`"
              class="block truncate font-medium underline-offset-4 hover:underline focus-visible:underline pointer-coarse:leading-11"
            >
              {{ recording.roomName }}
            </NuxtLink>
            <span class="block text-xs text-muted-foreground md:hidden">{{ formatDateTime(recording.startedAt) }}</span>
            <span v-if="recording.mode === 'local'" class="block text-xs text-muted-foreground">
              Saved on the recorder's device
            </span>
            <!-- Phones: the status sits under the room so the actions stay in view. -->
            <RecordingStatusBadge :recording="recording" class="mt-1.5 sm:hidden" />
          </TableCell>
          <TableCell class="hidden whitespace-nowrap md:table-cell">{{
            formatDateTime(recording.startedAt)
          }}</TableCell>
          <TableCell v-if="admin" class="hidden max-w-40 truncate lg:table-cell">{{
            recording.createdBy.displayName
          }}</TableCell>
          <TableCell class="hidden tabular-nums sm:table-cell">{{ formatDuration(recording.durationMs) }}</TableCell>
          <TableCell class="hidden tabular-nums sm:table-cell">{{ formatSize(recording.sizeBytes) }}</TableCell>
          <TableCell class="hidden sm:table-cell"><RecordingStatusBadge :recording="recording" /></TableCell>
          <TableCell>
            <div class="flex items-center justify-end gap-1">
              <template v-if="isPlayable(recording)">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon-sm" as-child>
                      <NuxtLink
                        :to="`/recordings/${recording.id}`"
                        :aria-label="`Play the recording of ${recording.roomName}`"
                      >
                        <PlayIcon aria-hidden="true" />
                      </NuxtLink>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Play</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon-sm" as-child>
                      <a
                        :href="fileUrl(recording.id, true)"
                        download
                        :aria-label="`Download the recording of ${recording.roomName}`"
                      >
                        <DownloadIcon aria-hidden="true" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download</TooltipContent>
                </Tooltip>
              </template>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground hover:text-destructive"
                    :disabled="!canDelete(recording)"
                    :aria-label="`Delete the recording of ${recording.roomName}`"
                    data-testid="delete-recording"
                    @click="emit('delete', recording)"
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{
                  canDelete(recording) ? 'Delete' : 'Available once processing has finished'
                }}</TooltipContent>
              </Tooltip>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TooltipProvider>
</template>
