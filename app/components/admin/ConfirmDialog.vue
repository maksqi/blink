<script setup lang="ts">
/**
 * In-page confirmation before a destructive admin action (never `confirm()`). The dialog stays open while `pending`
 * and shows `error` inline, so a refused action (last admin, own account) explains itself where it happened. The default
 * slot holds extra options (e.g. "email it instead").
 */
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
import FormAlert from '@/components/auth/FormAlert.vue'

const open = defineModel<boolean>('open', { required: true })
withDefaults(
  defineProps<{
    title: string
    description: string
    confirmLabel: string
    pending?: boolean
    error?: string | null
    destructive?: boolean
  }>(),
  { pending: false, error: null, destructive: true },
)
const emit = defineEmits<{ confirm: [] }>()
defineSlots<{ default?(): unknown }>()
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent data-testid="confirm-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription>{{ description }}</AlertDialogDescription>
      </AlertDialogHeader>
      <slot />
      <FormAlert :message="error" />
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="pending">Cancel</AlertDialogCancel>
        <Button
          :variant="destructive ? 'destructive' : 'default'"
          :disabled="pending"
          data-testid="confirm-action"
          @click="emit('confirm')"
        >
          <Spinner v-if="pending" data-icon="inline-start" />
          {{ confirmLabel }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
