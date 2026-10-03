<script setup lang="ts">
/**
 * /admin: counts (accounts, rooms, live meetings), the email status and links to every section. Live meetings are
 * counted from the first 100 rooms of the live-first rooms list (shown as "100+" beyond that) (decision: there is no
 * counts endpoint).
 */
import {
  ArrowRightIcon,
  DoorOpenIcon,
  FilmIcon,
  MailPlusIcon,
  RadioIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from '@lucide/vue'
import type { AdminRoom, AdminUser } from '#shared/schemas/admin'
import type { Paginated } from '#shared/schemas/common'
import type { Settings } from '#shared/schemas/settings'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import AppPageHeader from '@/components/app/AppPageHeader.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Admin' })

const LIVE_SAMPLE = 100

interface Overview {
  users: number | null
  rooms: number | null
  live: string | null
  smtp: boolean | null
}

const api = useApi()
const overview = ref<Overview | null>(null)

async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch {
    return null
  }
}

onMounted(async () => {
  const [users, rooms, settings] = await Promise.all([
    settle(api<Paginated<AdminUser>>('/api/admin/users', { query: { pageSize: 1 } })),
    settle(api<Paginated<AdminRoom>>('/api/admin/rooms', { query: { pageSize: LIVE_SAMPLE } })),
    settle(api<{ settings: Settings; smtp: { configured: boolean } }>('/api/admin/settings')),
  ])
  const live = rooms ? rooms.items.filter((room) => room.live).length : null
  overview.value = {
    users: users?.total ?? null,
    rooms: rooms?.total ?? null,
    live: live === null ? null : live === LIVE_SAMPLE ? `${LIVE_SAMPLE}+` : String(live),
    smtp: settings ? settings.smtp.configured : null,
  }
})

const stats = computed(() => [
  { label: 'Accounts', value: overview.value?.users, to: '/admin/users', icon: UsersIcon, testid: 'stat-users' },
  { label: 'Rooms', value: overview.value?.rooms, to: '/admin/rooms', icon: DoorOpenIcon, testid: 'stat-rooms' },
  { label: 'Live meetings', value: overview.value?.live, to: '/admin/rooms', icon: RadioIcon, testid: 'stat-live' },
])

const SECTIONS = [
  { title: 'Users', description: 'Create accounts, change roles, disable or delete.', to: '/admin/users', icon: UsersIcon },
  { title: 'Invites', description: 'Invite links for new accounts.', to: '/admin/invites', icon: MailPlusIcon },
  { title: 'Rooms', description: 'Live meetings, history, end or delete rooms.', to: '/admin/rooms', icon: DoorOpenIcon },
  { title: 'Recordings', description: 'Every recording on this server.', to: '/admin/recordings', icon: FilmIcon },
  {
    title: 'Settings',
    description: 'Registration, guests, media, limits, recording and retention.',
    to: '/admin/settings',
    icon: SlidersHorizontalIcon,
  },
  { title: 'Audit log', description: 'Admin actions, sign-ins and moderation.', to: '/admin/audit', icon: ScrollTextIcon },
]
</script>

<template>
  <div>
    <AppPageHeader title="Admin" description="An overview of this server.">
      <template #actions>
        <Skeleton v-if="!overview" class="h-6 w-36" />
        <NuxtLink
          v-else-if="overview.smtp !== null"
          to="/admin/settings"
          class="inline-flex items-center rounded-full pointer-coarse:min-h-11"
          data-testid="smtp-badge"
        >
          <Badge :variant="overview.smtp ? 'secondary' : 'outline'">
            {{ overview.smtp ? 'Email configured' : 'Email not configured' }}
          </Badge>
        </NuxtLink>
      </template>
    </AppPageHeader>

    <div class="grid gap-4 sm:grid-cols-3">
      <NuxtLink
        v-for="stat in stats"
        :key="stat.label"
        :to="stat.to"
        class="group rounded-xl border bg-card p-5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        :data-testid="stat.testid"
      >
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <span>{{ stat.label }}</span>
          <component :is="stat.icon" class="size-4" aria-hidden="true" />
        </div>
        <Skeleton v-if="!overview" class="mt-3 h-8 w-16" />
        <p v-else class="mt-2 text-3xl font-semibold tabular-nums">{{ stat.value ?? '—' }}</p>
      </NuxtLink>
    </div>

    <h2 class="mt-10 mb-4 text-lg font-semibold tracking-tight">Sections</h2>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="section in SECTIONS"
        :key="section.to"
        :to="section.to"
        class="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card class="h-full transition-colors group-hover:bg-muted/40">
          <CardHeader>
            <CardTitle class="flex items-center gap-2 text-base">
              <component :is="section.icon" class="size-4 text-muted-foreground" aria-hidden="true" />
              {{ section.title }}
              <ArrowRightIcon
                class="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </CardTitle>
            <CardDescription>{{ section.description }}</CardDescription>
          </CardHeader>
        </Card>
      </NuxtLink>
    </div>
  </div>
</template>
