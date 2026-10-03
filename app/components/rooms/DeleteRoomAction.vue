<script setup lang="ts">
/** Delete the room (owner): ends a live meeting, removes the room and forgets its key on this device. */
import { Trash2Icon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { RoomDetails } from '#shared/schemas/rooms'
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
import { useKeyVault } from '~/composables/rooms/useKeyVault'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { authErrorText } from '~/composables/useAuth'

const props = defineProps<{ room: RoomDetails }>()

const rooms = useRoomsApi()
const vault = useKeyVault()
const open = ref(false)
const deleting = ref(false)

async function remove() {
  deleting.value = true
  try {
    await rooms.remove(props.room.id)
    vault.remove(props.room.id)
    vault.tab.remove(props.room.slug)
    open.value = false
    toast.success(`${props.room.name} was deleted`)
    await navigateTo('/dashboard')
  } catch (error) {
    toast.error("The room couldn't be deleted", { description: authErrorText(error) })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3" data-testid="delete-room">
    <div class="min-w-0 max-w-prose text-sm">
      <p class="font-medium">Delete this room</p>
      <p class="text-muted-foreground">Its links stop working for good. A meeting in progress ends for everyone.</p>
    </div>
    <Button variant="destructive" data-testid="delete-room-open" @click="open = true">
      <Trash2Icon data-icon="inline-start" aria-hidden="true" />
      Delete room
    </Button>

    <AlertDialog v-model:open="open">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ room.name }}?</AlertDialogTitle>
          <AlertDialogDescription>
            {{ room.live ? 'The meeting in progress ends for everyone. ' : '' }}All links and invites of this room stop
            working. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Cancel</AlertDialogCancel>
          <Button variant="destructive" :disabled="deleting" data-testid="delete-room-confirm" @click="remove">
            <Spinner v-if="deleting" data-icon="inline-start" />
            Delete room
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
