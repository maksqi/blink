<script setup lang="ts">
/**
 * "Rotate key" (owner, docs/SECURITY.md §3.5): a new key K and proof (`PUT /api/rooms/:id/key`), only while no meeting
 * is live. Every old host and invite link then fails with `ROOM_KEY_INVALID`; invites keep working once their links
 * are copied again with the new key. The new key is stored in this device's vault, which also recovers a room whose
 * key this device never had.
 */
import { KeyRoundIcon } from '@lucide/vue'
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
import { newRoomKey } from '~/lib/join/create-room'
import { useKeyVault } from '~/composables/rooms/useKeyVault'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { authErrorText } from '~/composables/useAuth'

const props = defineProps<{ room: RoomDetails }>()
const emit = defineEmits<{ rotated: [room: RoomDetails] }>()

const rooms = useRoomsApi()
const vault = useKeyVault()
const open = ref(false)
const rotating = ref(false)

async function rotate() {
  rotating.value = true
  try {
    const { key, proof } = await newRoomKey(props.room.slug)
    const room = await rooms.rotateKey(props.room.id, proof)
    vault.save({ roomId: room.id, slug: room.slug, key, keyVersion: room.keyVersion })
    vault.tab.remove(room.slug)
    open.value = false
    emit('rotated', room)
    toast.success('Room key rotated', { description: 'Old links no longer work. Copy and send new links.' })
  } catch (error) {
    toast.error("The key couldn't be rotated", { description: authErrorText(error) })
  } finally {
    rotating.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3" data-testid="rotate-key">
    <div class="min-w-0 max-w-prose text-sm">
      <p class="font-medium">Rotate the room key</p>
      <p class="text-muted-foreground">
        Makes a new encryption key. Every link sent so far stops working, so do this after removing someone.
      </p>
      <p v-if="room.live" class="mt-1 text-amber-700 dark:text-amber-300">Possible once the current meeting ends.</p>
    </div>
    <Button variant="outline" :disabled="room.live" data-testid="rotate-key-open" @click="open = true">
      <KeyRoundIcon data-icon="inline-start" aria-hidden="true" />
      Rotate key
    </Button>

    <AlertDialog v-model:open="open">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rotate the room key?</AlertDialogTitle>
          <AlertDialogDescription>
            All host and invite links sent so far stop working. Invites stay valid: copy their links again to send them
            with the new key. Co-hosts get the new key when they open a new host link.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="rotating">Cancel</AlertDialogCancel>
          <Button :disabled="rotating" data-testid="rotate-key-confirm" @click="rotate">
            <Spinner v-if="rotating" data-icon="inline-start" />
            Rotate key
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
