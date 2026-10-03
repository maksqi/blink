<script setup lang="ts">
/**
 * Co-hosts of the room (`RoomDetails.cohosts`). The owner can remove them (`DELETE /api/rooms/:id/cohosts/:userId`).
 * People become co-hosts when a host promotes them during a meeting.
 */
import { UserMinusIcon } from '@lucide/vue'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { initials } from '~/lib/shell/initials'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { authErrorText } from '~/composables/useAuth'

type Cohost = RoomDetails['cohosts'][number]

const props = defineProps<{ room: RoomDetails }>()
const emit = defineEmits<{ removed: [userId: string] }>()

const rooms = useRoomsApi()
const target = shallowRef<Cohost | null>(null)
const open = ref(false)
const removing = ref(false)

function askRemove(cohost: Cohost) {
  target.value = cohost
  open.value = true
}

async function confirmRemove() {
  const cohost = target.value
  if (!cohost) return
  removing.value = true
  try {
    await rooms.removeCohost(props.room.id, cohost.userId)
    open.value = false
    emit('removed', cohost.userId)
    toast.success(`${cohost.displayName} is no longer a co-host`, {
      description: 'Rotate the room key before the next meeting to lock them out completely.',
    })
  } catch (error) {
    toast.error("The co-host couldn't be removed", { description: authErrorText(error) })
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div data-testid="cohost-list">
    <p v-if="room.cohosts.length === 0" class="text-sm text-muted-foreground">
      No co-hosts. During a meeting, a host can make someone with an account a co-host.
    </p>
    <ul v-else class="divide-y rounded-lg border">
      <li v-for="cohost in room.cohosts" :key="cohost.userId" class="flex items-center gap-3 px-4 py-3">
        <Avatar class="size-8">
          <AvatarFallback class="text-xs">{{ initials(cohost.displayName) }}</AvatarFallback>
        </Avatar>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ cohost.displayName }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ cohost.email }}</p>
        </div>
        <Button
          v-if="room.isOwner"
          variant="ghost"
          size="sm"
          :aria-label="`Remove ${cohost.displayName} as co-host`"
          @click="askRemove(cohost)"
        >
          <UserMinusIcon data-icon="inline-start" aria-hidden="true" />
          Remove
        </Button>
      </li>
    </ul>

    <AlertDialog v-model:open="open">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {{ target?.displayName }} as co-host?</AlertDialogTitle>
          <AlertDialogDescription>
            They can no longer manage this room or skip its waiting room and password. They may still know the room key,
            so rotate it before the next meeting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="removing">Cancel</AlertDialogCancel>
          <Button variant="destructive" :disabled="removing" @click="confirmRemove">
            <Spinner v-if="removing" data-icon="inline-start" />
            Remove co-host
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
