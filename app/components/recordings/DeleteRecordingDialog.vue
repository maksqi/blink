<script setup lang="ts">
/** Confirmation before a recording and its file are deleted for good. */
import type { RecordingSummary } from '#shared/schemas/recordings'
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
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime } from './RecordingMeta.vue'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ recording: RecordingSummary | null; pending: boolean }>()
const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
        <AlertDialogDescription v-if="recording">
          The recording of {{ recording.roomName }} from {{ formatDateTime(recording.startedAt) }} is deleted for
          everyone who can see it. This cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="pending">Cancel</AlertDialogCancel>
        <Button
          variant="destructive"
          :disabled="pending"
          data-testid="confirm-delete-recording"
          @click="emit('confirm')"
        >
          <Spinner v-if="pending" data-icon="inline-start" />
          Delete recording
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
