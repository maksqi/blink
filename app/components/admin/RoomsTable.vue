<script setup lang="ts">
/**
 * Rooms of `/admin/rooms`: owner, live state with the participant count, activity; per row the meeting history
 * (expandable), "End meeting" for live rooms and "Delete". Admins see metadata only.
 */
import { ChevronDownIcon, CircleStopIcon, Trash2Icon } from '@lucide/vue'
import type { AdminRoom } from '#shared/schemas/admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import AdminTime from './AdminTime.vue'
import RoomMeetings from './RoomMeetings.vue'

defineProps<{ items: AdminRoom[] }>()
const emit = defineEmits<{ end: [room: AdminRoom]; delete: [room: AdminRoom] }>()

const expanded = ref(new Set<string>())

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
</script>

<template>
  <TooltipProvider>
    <Table data-testid="rooms-table">
      <TableHeader>
        <TableRow>
          <TableHead>Room</TableHead>
          <TableHead class="hidden md:table-cell">Owner</TableHead>
          <TableHead class="hidden sm:table-cell">Status</TableHead>
          <TableHead class="hidden lg:table-cell">Last active</TableHead>
          <TableHead class="text-right"><span class="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="room in items" :key="room.id">
          <TableRow :data-room-id="room.id" data-testid="room-row">
            <TableCell class="w-full max-w-0">
              <button
                type="button"
                class="flex max-w-full items-center gap-1.5 rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-expanded="expanded.has(room.id)"
                :aria-controls="`room-history-${room.id}`"
                :aria-label="`Meeting history of ${room.name}`"
                data-testid="room-history-toggle"
                @click="toggle(room.id)"
              >
                <ChevronDownIcon
                  class="size-4 shrink-0 text-muted-foreground transition-transform"
                  :class="expanded.has(room.id) ? 'rotate-0' : '-rotate-90'"
                  aria-hidden="true"
                />
                <span class="truncate">{{ room.name }}</span>
              </button>
              <span class="block truncate pl-5.5 font-mono text-xs text-muted-foreground">{{ room.slug }}</span>
              <span class="block truncate pl-5.5 text-xs text-muted-foreground md:hidden">{{ room.owner.displayName }}</span>
              <span class="mt-1 flex flex-wrap gap-1 pl-5.5 sm:hidden">
                <Badge v-if="room.live" variant="default">Live · {{ room.participantCount }}</Badge>
                <Badge v-else variant="outline">Idle</Badge>
              </span>
            </TableCell>
            <TableCell class="hidden max-w-56 min-w-0 md:table-cell">
              <span class="block truncate">{{ room.owner.displayName }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ room.owner.email }}</span>
            </TableCell>
            <TableCell class="hidden sm:table-cell">
              <span class="flex flex-wrap gap-1">
                <Badge v-if="room.live" variant="default" data-testid="room-live">
                  Live · {{ room.participantCount }}
                  <span class="sr-only">{{ room.participantCount === 1 ? 'participant' : 'participants' }}</span>
                </Badge>
                <Badge v-else variant="outline">Idle</Badge>
                <Badge v-if="room.ephemeral" variant="outline">Instant</Badge>
              </span>
            </TableCell>
            <TableCell class="hidden lg:table-cell">
              <AdminTime :iso="room.lastActiveAt ?? room.createdAt" />
            </TableCell>
            <TableCell>
              <div class="flex items-center justify-end gap-1">
                <Tooltip v-if="room.live">
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="`End the meeting in ${room.name}`"
                      data-testid="end-room"
                      @click="emit('end', room)"
                    >
                      <CircleStopIcon aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>End meeting</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="text-muted-foreground hover:text-destructive"
                      :aria-label="`Delete ${room.name}`"
                      data-testid="delete-room"
                      @click="emit('delete', room)"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete room</TooltipContent>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-if="expanded.has(room.id)" :id="`room-history-${room.id}`" class="bg-muted/30 hover:bg-muted/30">
            <TableCell colspan="5" class="whitespace-normal">
              <RoomMeetings :room-id="room.id" />
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </TooltipProvider>
</template>
