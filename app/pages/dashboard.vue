<script setup lang="ts">
/**
 * `/dashboard` (rooms-ui, Stage 04): start an instant meeting, create a room, and open the rooms the user owns or
 * co-hosts (join, copy the host link, settings). Room keys are generated here, in the browser, and kept in the key
 * vault of this device.
 */
import { PlusIcon, VideoIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import CreateRoomDialog from '@/components/rooms/CreateRoomDialog.vue'
import RoomList from '@/components/rooms/RoomList.vue'
import { useCreateRoom } from '~/composables/rooms/useCreateRoom'
import { authErrorText, useAuthPageConfig } from '~/composables/useAuth'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Dashboard' })

const { data: config } = await useAuthPageConfig()
const { createAndOpen } = useCreateRoom()

const createOpen = ref(false)
const starting = ref(false)
const publicUrl = computed(() => config.value?.publicUrl ?? '')

async function startInstantMeeting() {
  if (starting.value) return
  starting.value = true
  try {
    await createAndOpen({ name: 'Instant meeting', ephemeral: true })
  } catch (error) {
    toast.error("The meeting couldn't be started", { description: authErrorText(error) })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div>
    <AppPageHeader
      title="Dashboard"
      description="Start a meeting now, or open one of your rooms. Every meeting is end-to-end encrypted."
    >
      <template #actions>
        <Button variant="outline" data-testid="new-room" @click="createOpen = true">
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          New room
        </Button>
        <Button :disabled="starting" data-testid="instant-meeting" @click="startInstantMeeting">
          <Spinner v-if="starting" data-icon="inline-start" />
          <VideoIcon v-else data-icon="inline-start" aria-hidden="true" />
          Instant meeting
        </Button>
      </template>
    </AppPageHeader>

    <RoomList :public-url="publicUrl" @create="createOpen = true" />
    <CreateRoomDialog v-model:open="createOpen" />
  </div>
</template>
