<script setup lang="ts">
/** "Waiting room" side panel (hosts and co-hosts): people waiting in request order, with Admit, Deny and Admit all. */
import { CheckIcon, HourglassIcon, XIcon } from '@lucide/vue'
import { useIntervalFn } from '@vueuse/core'
import { computed, shallowRef } from 'vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useCall } from '~/composables/call'
import { useLobby } from '~/lib/call/features/lobby/useLobby'
import { initials } from '~/lib/shell/initials'

const ctx = useCall()
const lobby = useLobby()
const entries = computed(() => lobby.entries.value)

const now = shallowRef(Date.now())
useIntervalFn(() => (now.value = Date.now()), 15_000)

function waited(requestedAt: string): string {
  const minutes = Math.floor((now.value - Date.parse(requestedAt)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'Just now'
  return minutes === 1 ? '1 min' : `${minutes} min`
}

const roomLocked = computed(() => ctx.roomState.value?.locked === true)
</script>

<template>
  <div class="flex flex-col gap-3 p-3" data-testid="lobby-panel">
    <div class="flex items-center justify-between gap-2 px-1">
      <p class="text-sm text-muted-foreground" aria-live="polite">
        <template v-if="entries.length === 0">Nobody is waiting.</template>
        <template v-else-if="entries.length === 1">1 person is waiting.</template>
        <template v-else>{{ entries.length }} people are waiting.</template>
      </p>
      <Button
        v-if="entries.length > 1"
        size="sm"
        :disabled="lobby.admittingAll.value"
        data-testid="lobby-admit-all"
        @click="lobby.admitAll()"
      >
        <Spinner v-if="lobby.admittingAll.value" />
        Admit all
      </Button>
    </div>
    <p v-if="roomLocked" class="rounded-lg bg-white/5 px-3 py-2 text-xs text-muted-foreground">
      The meeting is locked, so nobody new can ask to join.
    </p>
    <ul v-if="entries.length > 0" class="flex flex-col gap-1">
      <li
        v-for="entry in entries"
        :key="entry.requestId"
        class="flex min-h-12 flex-wrap items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/4"
        data-testid="lobby-entry"
        :data-request-id="entry.requestId"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold"
          aria-hidden="true"
          >{{ initials(entry.displayName) }}</span
        >
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-sm font-medium" data-testid="lobby-entry-name">{{ entry.displayName }}</span>
            <span
              v-if="entry.kind === 'guest'"
              class="inline-flex h-5 shrink-0 items-center rounded-md bg-white/15 px-1.5 text-[0.6875rem] font-semibold text-white/90"
              >Guest</span
            >
          </div>
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <HourglassIcon class="size-3" aria-hidden="true" />
            {{ waited(entry.requestedAt) }}
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            :disabled="lobby.deciding.value.has(entry.requestId)"
            :aria-label="`Deny ${entry.displayName}`"
            data-testid="lobby-deny"
            @click="lobby.decide(entry, 'deny')"
          >
            <XIcon aria-hidden="true" />
            Deny
          </Button>
          <Button
            size="sm"
            :disabled="lobby.deciding.value.has(entry.requestId)"
            :aria-label="`Admit ${entry.displayName}`"
            data-testid="lobby-admit"
            @click="lobby.decide(entry, 'admit')"
          >
            <CheckIcon aria-hidden="true" />
            Admit
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
