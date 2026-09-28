<script setup lang="ts">
/**
 * `/settings/sessions`: the account's signed-in devices. Loaded on the client (times render in the viewer's time
 * zone), "This device" marks the current session, "Sign out" revokes one (the current one signs this browser out).
 */
import { LaptopIcon, MonitorSmartphoneIcon, RefreshCwIcon, SmartphoneIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { SessionInfo } from '#shared/schemas/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import FormAlert from './FormAlert.vue'

const { listSessions, revokeSession } = useAuth()
const sessions = ref<SessionInfo[] | null>(null)
const loadError = ref<string | null>(null)
const pendingId = ref<string | null>(null)

const dateTime = import.meta.client
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : null
const formatDate = (iso: string) => dateTime?.format(new Date(iso)) ?? iso

async function load() {
  loadError.value = null
  try {
    sessions.value = await listSessions()
  } catch (error) {
    loadError.value = authErrorText(error)
  }
}

async function revoke(session: SessionInfo) {
  if (pendingId.value) return
  pendingId.value = session.id
  try {
    await revokeSession(session)
    if (!session.current) {
      sessions.value = (sessions.value ?? []).filter((item) => item.id !== session.id)
      toast.success('Signed out of that device')
    }
  } catch (error) {
    toast.error('Could not sign out that device', { description: authErrorText(error) })
  } finally {
    pendingId.value = null
  }
}

function deviceIcon(userAgent: string | null) {
  const { os } = describeUserAgent(userAgent)
  if (os === 'iOS' || os === 'Android') return SmartphoneIcon
  if (os) return LaptopIcon
  return MonitorSmartphoneIcon
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="session-list">
    <FormAlert :message="loadError" title="Sessions could not be loaded" />
    <Button v-if="loadError" variant="outline" class="self-start" @click="load">
      <RefreshCwIcon aria-hidden="true" />
      Try again
    </Button>

    <div v-else-if="!sessions" class="flex flex-col gap-3" aria-busy="true" aria-label="Loading sessions">
      <Skeleton v-for="n in 2" :key="n" class="h-[4.5rem] w-full rounded-lg" />
    </div>

    <ItemGroup v-else class="gap-3">
      <Item
        v-for="session in sessions"
        :key="session.id"
        variant="outline"
        class="bg-card"
        :data-current="session.current || undefined"
        data-testid="session-item"
      >
        <ItemMedia class="size-10 rounded-lg bg-muted text-muted-foreground">
          <component :is="deviceIcon(session.userAgent)" class="size-5" aria-hidden="true" />
        </ItemMedia>
        <ItemContent class="min-w-0">
          <ItemTitle class="flex flex-wrap items-center gap-2">
            <span class="truncate">{{ describeUserAgent(session.userAgent).label }}</span>
            <Badge v-if="session.current" variant="secondary" data-testid="this-device">This device</Badge>
          </ItemTitle>
          <ItemDescription class="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Last active {{ formatDate(session.lastSeenAt) }}</span>
            <span>Signed in {{ formatDate(session.createdAt) }}</span>
            <span v-if="session.ip" class="font-mono text-xs leading-5">{{ session.ip }}</span>
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            variant="outline"
            size="sm"
            :disabled="pendingId !== null"
            :aria-label="
              session.current ? 'Sign out of this device' : `Sign out ${describeUserAgent(session.userAgent).label}`
            "
            @click="revoke(session)"
          >
            <Spinner v-if="pendingId === session.id" />
            {{ session.current ? 'Sign out here' : 'Sign out' }}
          </Button>
        </ItemActions>
      </Item>
      <p v-if="sessions.length === 1" class="text-sm text-muted-foreground">
        This is the only device signed in to your account.
      </p>
    </ItemGroup>
  </div>
</template>
