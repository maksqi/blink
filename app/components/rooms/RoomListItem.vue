<script setup lang="ts">
/**
 * One room on the dashboard: name, live state, role, and the actions join, copy host link and settings. Joining and
 * the host link need the room key, which only devices that created (or opened) the room have.
 */
import { CopyIcon, DoorOpenIcon, KeyRoundIcon, LockKeyholeIcon, SettingsIcon, ZapIcon } from '@lucide/vue'
import type { RoomSummary } from '#shared/schemas/rooms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelativeTime } from '~/lib/join/format'

const props = defineProps<{ room: RoomSummary; hasKey: boolean; now: number }>()
const emit = defineEmits<{ copyLink: [room: RoomSummary] }>()

const activity = computed(() =>
  props.room.lastActiveAt
    ? `Active ${formatRelativeTime(props.room.lastActiveAt, props.now)}`
    : `Created ${formatRelativeTime(props.room.createdAt, props.now)}`,
)
</script>

<template>
  <Item variant="outline" class="bg-card" data-testid="room-item" :data-slug="room.slug" :data-live="room.live">
    <ItemMedia
      class="relative size-10 rounded-lg bg-muted text-muted-foreground"
      :class="room.live ? 'bg-primary/10 text-primary' : undefined"
    >
      <ZapIcon v-if="room.ephemeral" class="size-5" aria-hidden="true" />
      <DoorOpenIcon v-else class="size-5" aria-hidden="true" />
      <span v-if="room.live" class="absolute -top-0.5 -right-0.5 flex size-2.5" aria-hidden="true">
        <span class="absolute inline-flex size-full rounded-full bg-primary/60 motion-safe:animate-ping" />
        <span class="relative inline-flex size-2.5 rounded-full bg-primary" />
      </span>
    </ItemMedia>

    <ItemContent class="min-w-0">
      <!-- w-full: ItemTitle is w-fit, which let a long name widen the row past a phone screen (F-057). -->
      <ItemTitle class="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <NuxtLink :to="`/rooms/${room.id}`" class="max-w-full min-w-0 truncate hover:underline pointer-coarse:leading-11" data-testid="room-name">
          {{ room.name }}
        </NuxtLink>
        <Badge v-if="room.live" class="bg-primary/15 text-primary" variant="secondary">
          Live · {{ room.participantCount }}
        </Badge>
        <Badge v-if="!room.isOwner" variant="outline">Co-host</Badge>
        <Badge v-if="room.ephemeral" variant="outline">Instant</Badge>
      </ItemTitle>
      <ItemDescription class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-mono text-xs">{{ room.slug }}</span>
        <span>{{ activity }}</span>
        <span v-if="room.hasPassword" class="inline-flex items-center gap-1">
          <LockKeyholeIcon class="size-3.5" aria-hidden="true" />
          Password
        </span>
        <span v-if="!hasKey" class="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
          <KeyRoundIcon class="size-3.5" aria-hidden="true" />
          Key not on this device
        </span>
      </ItemDescription>
    </ItemContent>

    <ItemActions class="w-full justify-end sm:w-auto">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="!hasKey"
            :aria-label="`Copy the host link of ${room.name}`"
            data-testid="room-copy-link"
            @click="emit('copyLink', room)"
          >
            <CopyIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ hasKey ? 'Copy host link' : 'The room key is not on this device' }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" as-child>
            <NuxtLink :to="`/rooms/${room.id}`" :aria-label="`Settings and invites of ${room.name}`">
              <SettingsIcon aria-hidden="true" />
            </NuxtLink>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings and invites</TooltipContent>
      </Tooltip>
      <Button v-if="hasKey" :variant="room.live ? 'default' : 'outline'" size="sm" as-child>
        <NuxtLink :to="`/m/${room.slug}`" data-testid="room-join">Join</NuxtLink>
      </Button>
      <Button v-else variant="outline" size="sm" disabled data-testid="room-join">Join</Button>
    </ItemActions>
  </Item>
</template>
