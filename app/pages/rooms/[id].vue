<script setup lang="ts">
/**
 * `/rooms/<id>` (rooms-ui, Stage 04): one room for its owner and co-hosts. Invites, settings and password, co-hosts,
 * meeting history, key rotation and deletion. Owner-only actions are hidden for co-hosts and refused by the server.
 * Links are built on this device from the key in its vault; the page says when that key is missing or outdated.
 */
import { ArrowLeftIcon, CopyIcon, KeyRoundIcon, VideoIcon } from '@lucide/vue'
import { useMounted } from '@vueuse/core'
import type { RoomDetails } from '#shared/schemas/rooms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import FormAlert from '@/components/auth/FormAlert.vue'
import CohostList from '@/components/rooms/CohostList.vue'
import DeleteRoomAction from '@/components/rooms/DeleteRoomAction.vue'
import InviteManager from '@/components/rooms/InviteManager.vue'
import MeetingHistory from '@/components/rooms/MeetingHistory.vue'
import RoomPasswordForm from '@/components/rooms/RoomPasswordForm.vue'
import RoomSettingsForm from '@/components/rooms/RoomSettingsForm.vue'
import RotateKeyAction from '@/components/rooms/RotateKeyAction.vue'
import { buildRoomLink } from '~/lib/e2ee/fragment'
import { useKeyVault } from '~/composables/rooms/useKeyVault'
import { useLinkSharing } from '~/composables/rooms/useLinkSharing'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { ApiError } from '~/composables/useApi'
import { authErrorText, useAuthPageConfig } from '~/composables/useAuth'

definePageMeta({ middleware: 'auth' })

const REFRESH_MS = 20_000

const route = useRoute()
const roomId = computed(() => String(route.params.id ?? ''))
const { data: config } = await useAuthPageConfig()
const rooms = useRoomsApi()
const vault = useKeyVault()
const sharing = useLinkSharing()
const mounted = useMounted()

const room = shallowRef<RoomDetails | null>(null)
const status = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const loadError = ref<string | null>(null)

useHead({ title: computed(() => room.value?.name ?? 'Room') })

const publicUrl = computed(() => config.value?.publicUrl || (import.meta.client ? window.location.origin : ''))
const maxLimit = computed(() => config.value?.limits.maxParticipantsPerRoom ?? 25)
const entry = computed(() => (mounted.value && room.value ? vault.get(room.value.id) : null))
const keyStatus = computed<'unknown' | 'ok' | 'missing' | 'stale'>(() => {
  if (!mounted.value || !room.value) return 'unknown'
  if (!entry.value) return 'missing'
  return entry.value.keyVersion === room.value.keyVersion ? 'ok' : 'stale'
})
const roomKey = computed(() => (keyStatus.value === 'ok' ? (entry.value?.key ?? null) : null))

let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0

async function load(quiet = false) {
  const current = ++generation
  clearTimeout(timer)
  try {
    const next = await rooms.get(roomId.value)
    if (current !== generation) return
    room.value = next
    status.value = 'ready'
  } catch (error) {
    if (current !== generation) return
    if (error instanceof ApiError && (error.code === 'ROOM_NOT_FOUND' || error.status === 404)) {
      status.value = 'missing'
      return
    }
    if (!quiet || !room.value) {
      status.value = 'error'
      loadError.value = authErrorText(error)
    }
  }
  timer = setTimeout(() => void load(true), REFRESH_MS)
}

function update(next: RoomDetails) {
  room.value = next
}

function onCohostRemoved(userId: string) {
  if (room.value) room.value = { ...room.value, cohosts: room.value.cohosts.filter((c) => c.userId !== userId) }
}

function onRotated(next: RoomDetails) {
  room.value = next
}

function copyHostLink() {
  if (!room.value || !roomKey.value) return
  void sharing.copy(buildRoomLink(publicUrl.value, room.value.slug, roomKey.value), 'Host link copied')
}

onMounted(() => void load())
onBeforeUnmount(() => {
  generation++
  clearTimeout(timer)
})
watch(roomId, () => {
  room.value = null
  status.value = 'loading'
  void load()
})
</script>

<template>
  <div data-testid="room-page">
    <Button variant="ghost" size="sm" class="mb-4 -ml-2" as-child>
      <NuxtLink to="/dashboard">
        <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
        Dashboard
      </NuxtLink>
    </Button>

    <div v-if="status === 'loading'" class="space-y-4" aria-busy="true" aria-label="Loading the room">
      <Skeleton class="h-10 w-72" />
      <Skeleton class="h-48 w-full" />
    </div>

    <div v-else-if="status === 'missing'" class="max-w-xl" data-testid="room-missing">
      <AppPageHeader title="Room not found" description="It was deleted, or you are not its owner or a co-host." />
      <Button as-child>
        <NuxtLink to="/dashboard">Back to the dashboard</NuxtLink>
      </Button>
    </div>

    <div v-else-if="status === 'error'" class="flex max-w-xl flex-col items-start gap-3">
      <FormAlert :message="loadError" title="The room could not be loaded" />
      <Button variant="outline" @click="load()">Try again</Button>
    </div>

    <template v-else-if="room">
      <AppPageHeader :title="room.name">
        <template #description>
          <span class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm">{{ room.slug }}</span>
            <Badge v-if="room.live" variant="secondary" class="bg-primary/15 text-primary" data-testid="room-live">
              Live · {{ room.participantCount }}
            </Badge>
            <Badge v-if="!room.isOwner" variant="outline">Co-host</Badge>
            <Badge v-if="room.ephemeral" variant="outline">Instant meeting</Badge>
          </span>
        </template>
        <template #actions>
          <Button variant="outline" :disabled="!roomKey" data-testid="room-copy-host-link" @click="copyHostLink">
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
            Copy host link
          </Button>
          <Button v-if="roomKey" as-child>
            <NuxtLink :to="`/m/${room.slug}`" data-testid="room-page-join">
              <VideoIcon data-icon="inline-start" aria-hidden="true" />
              {{ room.live ? 'Join meeting' : 'Start meeting' }}
            </NuxtLink>
          </Button>
          <Button v-else disabled>
            <VideoIcon data-icon="inline-start" aria-hidden="true" />
            Start meeting
          </Button>
        </template>
      </AppPageHeader>

      <FormAlert
        v-if="keyStatus === 'missing' || keyStatus === 'stale'"
        class="mb-6"
        tone="info"
        :title="keyStatus === 'stale' ? 'The key on this device is out of date' : 'The room key is not on this device'"
        :message="
          room.isOwner
            ? 'Links and joining need the current key. Use the device where you last rotated the key, open a current host link here, or rotate the key below to make a new one on this device.'
            : 'Links and joining need the current key. Open a current host link from the owner on this device.'
        "
        data-testid="room-key-status"
        :data-status="keyStatus"
      />

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div class="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle><h2 class="text-lg font-semibold tracking-tight">Invite people</h2></CardTitle>
              <CardDescription>
                Everyone except hosts and co-hosts needs an invite link. Links carry the room key, so send them only to
                the people you invite.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteManager :room="room" :room-key="roomKey" :public-url="publicUrl" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><h2 class="text-lg font-semibold tracking-tight">Meetings</h2></CardTitle>
              <CardDescription>Each meeting gets its own encryption keys, derived from the room key.</CardDescription>
            </CardHeader>
            <CardContent>
              <MeetingHistory :room-id="room.id" />
            </CardContent>
          </Card>
        </div>

        <div class="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle><h2 class="text-lg font-semibold tracking-tight">Settings</h2></CardTitle>
              <CardDescription>Apply to every meeting in this room.</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-6">
              <RoomSettingsForm
                :room="room"
                :editable="room.isOwner"
                :max-participants-limit="maxLimit"
                @saved="update"
              />
              <template v-if="room.isOwner">
                <Separator />
                <div class="flex flex-col gap-3">
                  <h3 class="text-sm font-medium">Password</h3>
                  <RoomPasswordForm :room="room" @saved="update" />
                </div>
              </template>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><h2 class="text-lg font-semibold tracking-tight">Co-hosts</h2></CardTitle>
              <CardDescription>They can manage meetings and invites in this room.</CardDescription>
            </CardHeader>
            <CardContent>
              <CohostList :room="room" @removed="onCohostRemoved" />
            </CardContent>
          </Card>

          <Card v-if="room.isOwner">
            <CardHeader>
              <CardTitle>
                <h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <KeyRoundIcon class="size-4 text-muted-foreground" aria-hidden="true" />
                  Key and deletion
                </h2>
              </CardTitle>
              <CardDescription>Key version {{ room.keyVersion }}.</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-5">
              <RotateKeyAction :room="room" @rotated="onRotated" />
              <Separator />
              <DeleteRoomAction :room="room" />
            </CardContent>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>
